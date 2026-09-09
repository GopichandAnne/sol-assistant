// teams-messages — Microsoft Teams front door (Bot Framework messaging endpoint).
// Rani as a teammate in Teams: DMs + @mentions reach the same core (generateTurnReply)
// and the user's Azure AD identity flows through resolveIdentity.
//
// SETUP (when an Azure bot is ready):
//   • Azure Bot resource + an app registration (client id + secret).
//   • Messaging endpoint → this function's URL. Add the Teams channel.
//   • Graph app permission User.Read.All (+ admin consent) if you want email identity.
//   • Env: MICROSOFT_APP_ID, MICROSOFT_APP_PASSWORD.
//   • Map the tenant to a store: a teams_installs row { tenant_id, store_id } (set from
//     the console's Teams card).
import { serviceClient } from "../_shared/supabase.ts";
import { getStoreById } from "../_shared/config.ts";
import { generateTurnReply } from "../_shared/conversation.ts";
import { resolveIdentity } from "../_shared/identity.ts";
import { splitBubbles } from "../_shared/prompt.ts";
import { buildTeamsRawIdentity, classifyActivity, teamsSessionId } from "../_shared/teams.ts";
import { graphEmail, postTeamsReply, verifyBotFrameworkToken } from "../_shared/teams-auth.ts";

// deno-lint-ignore no-explicit-any
declare const EdgeRuntime: any;

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const appId = Deno.env.get("MICROSOFT_APP_ID") ?? "";
  const appPassword = Deno.env.get("MICROSOFT_APP_PASSWORD") ?? "";

  // Verify the request really came from Bot Framework (Bearer JWT vs their JWKS).
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
  const claims = await verifyBotFrameworkToken(token, appId);
  if (!claims) return new Response("unauthorized", { status: 401 });

  let activity: Record<string, unknown>;
  try {
    activity = await req.json();
  } catch {
    return new Response("bad json", { status: 400 });
  }

  const work = handleActivity(activity, appId, appPassword).catch((e) => console.error("[teams] handleActivity:", e));
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(work);
  else await work;
  return new Response(null, { status: 200 });
});

async function handleActivity(activity: Record<string, unknown>, appId: string, appPassword: string): Promise<void> {
  // An Approve / Decline tap on an approval card comes back as an ordinary message
  // activity carrying `value` (Action.Submit), NOT as text. Handle it before the
  // normal classify, which would otherwise ignore a message with no text.
  const val = activity.value as Record<string, unknown> | undefined;
  if (val && val.kind === "approval") {
    await handleApproval(activity, val, appId, appPassword);
    return;
  }

  const c = classifyActivity(activity);
  if (!c.act || !c.event) {
    console.log(`[teams] ignore: ${c.reason}`);
    return;
  }
  const ev = c.event;
  const db = serviceClient();

  // Dedup by activity id.
  if (ev.activityId) {
    const { error } = await db.from("teams_events").insert({ activity_id: ev.activityId });
    if (error) {
      console.log(`[teams] duplicate activity ${ev.activityId} — skipping`);
      return;
    }
  }

  // Tenant → store.
  const { data: install } = await db
    .from("teams_installs")
    .select("store_id")
    .eq("tenant_id", ev.tenantId)
    .eq("active", true)
    .maybeSingle();
  const storeId = (install as { store_id?: string } | null)?.store_id;
  if (!storeId) {
    console.warn(`[teams] no install for tenant ${ev.tenantId}`);
    return;
  }
  const store = await getStoreById(db, storeId);
  if (!store) return;

  const sessionId = teamsSessionId(ev.tenantId, ev.aadObjectId, ev.userId);

  // Remember how to reach this person. Bot Framework only hands you a conversation
  // when someone messages the bot, so an approver who has never used it cannot be
  // sent an approval card. Recording it on every inbound is what makes nominating
  // them later possible at all. Best-effort: never block a reply for it.
  let email: string | null = null;
  try {
    email = await graphEmail(appId, appPassword, ev.tenantId, ev.aadObjectId);
    await db.from("teams_user").upsert({
      tenant_id: ev.tenantId,
      teams_user_id: ev.userId,
      aad_object_id: ev.aadObjectId,
      email,
      name: ev.name ?? null,
      service_url: ev.serviceUrl,
      conversation_id: ev.conversationId,
      last_seen: new Date().toISOString(),
    }, { onConflict: "tenant_id,teams_user_id" });
  } catch (e) {
    console.warn(`[teams] remember user: ${(e as Error)?.message ?? e}`);
  }

  let visitor;
  if (store.access_control) {
    const raw = buildTeamsRawIdentity(ev.aadObjectId, ev.userId, ev.name, email);
    const resolved = await resolveIdentity(db, store, sessionId, { channel: "teams", raw });
    if (resolved) visitor = resolved.visitor;
  }

  const threadId = `thr_${sessionId}_${store.slug}`;
  await db.from("thread_messages").insert({
    message_id: `msg_teams_${crypto.randomUUID()}`,
    thread_id: threadId,
    store_slug: store.slug,
    customer_phone: sessionId,
    direction: "inbound",
    sender: "customer",
    text: ev.text,
    kind: "message",
    created_at: new Date().toISOString(),
  });

  const { text: reply } = await generateTurnReply(db, store, { sessionId, inboundText: ev.text, visitor });
  const finalReply = reply || "Sorry, I had a brief hiccup — could you send that again?";

  for (const bubble of splitBubbles(finalReply)) {
    const ok = await postTeamsReply(appId, appPassword, ev.serviceUrl, ev.conversationId, bubble);
    if (!ok) break;
    await db.from("thread_messages").insert({
      message_id: `msg_teams_out_${crypto.randomUUID()}`,
      thread_id: threadId,
      store_slug: store.slug,
      customer_phone: sessionId,
      direction: "outbound",
      sender: "agent",
      text: bubble,
      kind: "message",
      created_at: new Date().toISOString(),
    });
  }
}

/** Resolve a held action from an Approve / Decline tap in Teams.
 *
 *  Scoped to a still-pending row so a stale card cannot flip a decision that was
 *  already made in the console or in Slack, and so a second tap says so plainly
 *  rather than silently doing nothing. Same contract as slack-interactions:
 *  recording the decision is the whole action; nothing is re-run. */
async function handleApproval(
  activity: Record<string, unknown>,
  val: Record<string, unknown>,
  appId: string,
  appPassword: string,
): Promise<void> {
  const id = String(val.id ?? "");
  const decision = val.decision === "approved" ? "approved" : "declined";
  const from = (activity.from ?? {}) as Record<string, unknown>;
  const who = String(from.name ?? "someone");
  const serviceUrl = String(activity.serviceUrl ?? "");
  const conversationId = String((activity.conversation as Record<string, unknown> | undefined)?.id ?? "");
  if (!id || !serviceUrl || !conversationId) return;

  const db = serviceClient();
  const { data, error } = await db
    .from("action_request")
    .update({ status: decision, decided_by: `${who} (Teams)`, decided_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending")
    .select("id");

  const note = error
    ? "Couldn't record that, sorry. Try the Activity page in the console."
    : !data || data.length === 0
      ? "That one was already resolved."
      : `${decision === "approved" ? "Approved" : "Declined"} by ${who}. Nothing was re-run automatically — action it in your systems as usual.`;
  await postTeamsReply(appId, appPassword, serviceUrl, conversationId, note);
}
