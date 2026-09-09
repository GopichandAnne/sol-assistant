// slack-interactions — Approve/Decline button clicks from the governance messages
// posted by holds.ts. A click goes through the SAME resolver the console does, so
// approving in Slack runs the approved call, tells the person who asked, and lands
// the same audit row. Anything less would make the button a lie about what it did.
//
// SETUP: set this function's URL as the Slack app's Interactivity Request URL.
// Env: SLACK_SIGNING_SECRET (same app secret as slack-events).
import { serviceClient } from "../_shared/supabase.ts";
import { parseInteraction, verifySlackSignature } from "../_shared/slack.ts";
import { slackRespond } from "../_shared/slack-api.ts";
import { resolveActionRequest } from "../_shared/resolve.ts";
import { getStoreBySlug } from "../_shared/config.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const rawBody = await req.text();
  const ts = req.headers.get("x-slack-request-timestamp") ?? "";
  const sig = req.headers.get("x-slack-signature") ?? "";
  if (!await verifySlackSignature(Deno.env.get("SLACK_SIGNING_SECRET") ?? "", ts, rawBody, sig)) {
    return new Response("invalid signature", { status: 401 });
  }

  // Interactivity payloads arrive form-encoded as payload=<json>.
  const payloadStr = new URLSearchParams(rawBody).get("payload");
  if (!payloadStr) return new Response("ok", { status: 200 });
  let payload: unknown;
  try {
    payload = JSON.parse(payloadStr);
  } catch {
    return new Response("bad payload", { status: 400 });
  }

  const parsed = parseInteraction(payload);
  if (!parsed) return new Response("ok", { status: 200 }); // not an approval button — ignore

  const db = serviceClient();
  // The request itself says which assistant it belongs to; the resolver does the
  // rest (claim while pending, run it, tell them) exactly as the console does.
  const { data: reqRow } = await db
    .from("action_request")
    .select("store_id")
    .eq("id", parsed.actionRequestId)
    .maybeSingle();
  const storeId = (reqRow as { store_id?: string } | null)?.store_id;
  const { data: storeRow } = storeId
    ? await db.from("stores").select("slug").eq("id", storeId).maybeSingle()
    : { data: null };
  const slug = (storeRow as { slug?: string } | null)?.slug;
  const store = slug ? await getStoreBySlug(db, slug) : null;

  const outcome = store
    ? await resolveActionRequest(db, store, parsed.actionRequestId, parsed.decision, `${parsed.userName} (Slack)`)
    : { ok: false as const };

  if (parsed.responseUrl) {
    const verb = parsed.decision === "approved" ? "Approved" : "Declined";
    const ok = outcome.ok === true;
    const completed = (outcome as { completed?: boolean }).completed === true;
    const note = (outcome as { note?: string }).note ?? "";
    // Say what actually happened. A green tick on a write that failed is the one
    // outcome nobody can afford to misread.
    const msg = !ok
      ? "That request was already resolved."
      : parsed.decision === "declined"
        ? `🚫 ${verb} by ${parsed.userName}. Nothing ran.`
        : completed
          ? `✅ ${verb} by ${parsed.userName} — and it's done.`
          : `⚠️ ${verb} by ${parsed.userName}, but it didn't go through: ${note}`;
    await slackRespond(parsed.responseUrl, { replace_original: true, text: msg });
  }

  return new Response("ok", { status: 200 });
});
