// teams-messages — Microsoft Teams front door (Bot Framework messaging endpoint).
// The assistant as a teammate in Teams: DMs + @mentions reach the same core (generateTurnReply)
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
import { getStoreById, getStoreBySlug } from "../_shared/config.ts";
import { generateTurnReply } from "../_shared/conversation.ts";
import { resolveIdentity } from "../_shared/identity.ts";
import { splitBubbles } from "../_shared/prompt.ts";
import { buildTeamsRawIdentity, classifyActivity, teamsSessionId } from "../_shared/teams.ts";
import { rememberChannel, resolveStoreForChannel } from "../_shared/routing.ts";
import { handleTokenExchange, oauthCard, ssoConfigured, ssoConnectionName } from "../_shared/teams-sso.ts";
import { resolveActionRequest } from "../_shared/resolve.ts";
import { graphEmailDetailed, postTeamsActivity, postTeamsReply, verifyBotFrameworkToken } from "../_shared/teams-auth.ts";

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

  // Single sign-on token exchange is the one activity whose HTTP STATUS is the
  // answer: 200 means the token was accepted, 412 tells the Teams client to fall
  // back to asking the person to consent. So it cannot go through the background
  // path below, which always answers 200 before the work has happened.
  if (activity.type === "invoke" && activity.name === "signin/tokenExchange") {
    const status = await handleSsoExchange(activity);
    return new Response(null, { status });
  }
  // A failed sign-in arrives as its own activity. Nothing to do but notice it:
  // Teams has already told the person, and a log line is what turns "it didn't
  // work" into something answerable later.
  if (activity.type === "invoke" && activity.name === "signin/failure") {
    console.warn(`[teams] sign-in failed: ${JSON.stringify(activity.value ?? {}).slice(0, 200)}`);
    return new Response(null, { status: 200 });
  }

  const work = handleActivity(activity, appId, appPassword).catch((e) => console.error("[teams] handleActivity:", e));
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(work);
  else await work;
  return new Response(null, { status: 200 });
});

/**
 * Complete a single sign-on exchange for whichever assistant this organisation is
 * linked to, and store the result as that person's own connection.
 *
 * An unlinked tenant returns 412 rather than 200: there is no assistant to hold
 * the connection, and claiming success would leave the person believing they are
 * connected to something that does not exist.
 */
async function handleSsoExchange(activity: Record<string, unknown>): Promise<number> {
  const conv = (activity.conversation ?? {}) as Record<string, unknown>;
  const tenantId = String(
    (activity.channelData as Record<string, unknown> | undefined)?.tenant &&
      ((activity.channelData as Record<string, unknown>).tenant as Record<string, unknown>)?.id ||
      conv.tenantId || "",
  );
  if (!tenantId) return 412;

  const db = serviceClient();
  const { data: install } = await db
    .from("teams_installs")
    .select("store_id")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .maybeSingle();
  const storeId = (install as { store_id?: string } | null)?.store_id;
  if (!storeId) {
    console.warn(`[teams-sso] exchange from unlinked tenant ${tenantId}`);
    return 412;
  }
  return await handleTokenExchange(db, storeId, activity);
}

/**
 * Offer single sign-on to somebody who has not connected their own account yet.
 *
 * Best-effort and silent by design: no connection configured, no card; card
 * fails, nothing said. The person still has every shared capability, and the
 * personal ones explain themselves when asked. A failure here must never surface
 * as noise in a conversation that was about something else.
 */
async function maybeStartSso(
  // deno-lint-ignore no-explicit-any
  db: any, storeId: string, email: string,
  appId: string, appPassword: string, serviceUrl: string, conversationId: string,
): Promise<void> {
  try {
    const connection = ssoConnectionName();
    if (!connection || !ssoConfigured()) return;
    const { data } = await db.from("oauth_connection")
      .select("provider").eq("store_id", storeId).eq("provider", "microsoft")
      .eq("user_key", email.toLowerCase()).eq("status", "connected").maybeSingle();
    if (data) return; // already connected
    await postTeamsActivity(appId, appPassword, serviceUrl, conversationId, {
      type: "message",
      attachments: [oauthCard(connection, appId, "Connecting your Microsoft 365 so I can see your own calendar, mail and tasks.")],
    });
  } catch (e) {
    console.warn(`[teams-sso] could not offer sign-on: ${(e as Error)?.message ?? e}`);
  }
}

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
    // Not linked yet. Dropping this silently is why Teams used to look broken
    // before setup: someone messages the app, nothing happens, no explanation.
    // Record the tenant so the console can offer a one-click link, and TELL the
    // person, so the identifier reaches us without anyone visiting Azure.
    try {
      await db.from("teams_pending_tenant").upsert({
        tenant_id: ev.tenantId,
        sample_user: ev.name || null,
        last_seen: new Date().toISOString(),
      }, { onConflict: "tenant_id" });
    } catch (e) {
      console.warn(`[teams] record pending tenant: ${(e as Error)?.message ?? e}`);
    }
    console.warn(`[teams] no install for tenant ${ev.tenantId} — told the user`);
    await postTeamsReply(
      appId, appPassword, ev.serviceUrl, ev.conversationId,
      "I'm installed here but not connected to an assistant yet. Whoever set me up can finish it in one click: I've told them this workspace is waiting. Nothing you need to do.",
    );
    return;
  }
  // One org can run several assistants behind one install. Which one answers is
  // decided by the channel; a direct message takes the workspace default.
  await rememberChannel(db, "teams", ev.tenantId, ev.conversationId, ev.channelName, ev.isGroup);
  const routedId = await resolveStoreForChannel(db, "teams", ev.tenantId, ev.conversationId, storeId);
  const store = await getStoreById(db, routedId ?? storeId);
  if (!store) return;

  const sessionId = teamsSessionId(ev.tenantId, ev.aadObjectId, ev.userId);

  // Remember how to reach this person. Bot Framework only hands you a conversation
  // when someone messages the bot, so an approver who has never used it cannot be
  // sent an approval card. Recording it on every inbound is what makes nominating
  // them later possible at all. Best-effort: never block a reply for it.
  let email: string | null = null;
  try {
    const look = await graphEmailDetailed(appId, appPassword, ev.tenantId, ev.aadObjectId);
    email = look.email;
    // Record (or clear) a missing consent on the install, so the console can say
    // why everyone is anonymous and offer the link that fixes it, instead of the
    // owner discovering it when an approval goes nowhere.
    await db.from("teams_installs")
      .update({ consent_missing_at: look.problem === "consent" ? new Date().toISOString() : null })
      .eq("tenant_id", ev.tenantId);
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

  // Entra has already authenticated this person, so we ALWAYS know who they are —
  // that is what the audit trail, the personal Microsoft 365 tools and any call
  // made as them depend on. Membership is the separate question, and stays gated
  // on access control: admitting everyone who ever sent a message would hand out
  // members-only knowledge the moment an owner switched that on.
  let visitor;
  const raw = buildTeamsRawIdentity(ev.aadObjectId, ev.userId, ev.name, email);
  const resolved = await resolveIdentity(db, store, sessionId, {
    channel: "teams", raw, admit: !!store.access_control,
  });
  if (resolved) visitor = resolved.visitor;

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

  // If this person has no Microsoft 365 connection of their own, start the silent
  // sign-on now. Deliberately AFTER the reply is composed: the card is a
  // background convenience and must never make somebody wait for an answer. Teams
  // resolves it without showing them anything once their organisation has
  // consented, so the next time they ask for their own calendar it is simply there.
  if (email) void maybeStartSso(db, store.id, email, appId, appPassword, ev.serviceUrl, ev.conversationId);
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
 *  rather than silently doing nothing. Same contract as slack-interactions and the
 *  console: approving RUNS the approved call, as the person it was raised for, and
 *  tells them the outcome. */
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
  const { data: reqRow } = await db
    .from("action_request")
    .select("store_id")
    .eq("id", id)
    .maybeSingle();
  const storeId = (reqRow as { store_id?: string } | null)?.store_id;
  const { data: storeRow } = storeId
    ? await db.from("stores").select("slug").eq("id", storeId).maybeSingle()
    : { data: null };
  const slug = (storeRow as { slug?: string } | null)?.slug;
  const store = slug ? await getStoreBySlug(db, slug) : null;
  const outcome = store
    ? await resolveActionRequest(db, store, id, decision as "approved" | "declined", `${who} (Teams)`)
    : { ok: false as const };

  const note = !outcome.ok
    ? "That one was already resolved, or I couldn't find it. The Activity page in the console has the current state."
    : decision === "declined"
      ? `Declined by ${who}. Nothing ran.`
      : (outcome as { completed?: boolean }).completed
        ? `Approved by ${who} — and it's done.`
        : `Approved by ${who}, but it didn't go through: ${(outcome as { note?: string }).note ?? "the call failed"}. Someone will need to look at it.`;
  await postTeamsReply(appId, appPassword, serviceUrl, conversationId, note);
}
