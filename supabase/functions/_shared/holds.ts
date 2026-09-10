// Hold → ticket → notify. When a WRITE tool is held by policy (action_policy =
// 'hold'), the executor returns { held: true } and never runs the action. This
// module turns that hold into something real: a durable APPROVAL REQUEST a person
// can see and resolve, plus a notification to the team — so the promise the assistant makes
// ("I've opened a request and flagged it for your team, nothing's changed") is
// literally true, not a polite fiction.
//
// Never stores credentials or tokens — a delegated-identity hold records a human
// label for who it was acting as, never the token. Best-effort: a routing or
// notify failure must never break the chat (the write was already safely blocked).

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Store } from "./types.ts";
import { notifyResponders } from "./responders.ts";
import { buildApprovalBlocks } from "./slack.ts";
import { slackPostMessage } from "./slack-api.ts";
import { buildApprovalCard } from "./teams.ts";
import { postTeamsActivity } from "./teams-auth.ts";

/** If the store connected Slack and set an approvals channel, post Approve/Decline
 *  buttons there for this held action. Best-effort — a Slack failure never matters. */
async function postSlackApproval(
  db: SupabaseClient,
  store: Store,
  reqId: string,
  detail: string,
  actedAs: string | null,
): Promise<boolean> {
  try {
    // deno-lint-ignore no-explicit-any
    const from = db.from as unknown as (t: string) => any;
    const { data: install } = await from("slack_installs")
      .select("bot_token, approvals_channel")
      .eq("store_id", store.id)
      .eq("active", true)
      .maybeSingle();
    if (!install?.bot_token || !install?.approvals_channel) return false;
    const { text, blocks } = buildApprovalBlocks({ id: reqId, detail, orgName: store.store_display_name ?? store.slug, actedAs });
    return await slackPostMessage(install.bot_token, install.approvals_channel, text, blocks);
  } catch (e) {
    console.warn(`[holds] slack approval post: ${(e as Error)?.message ?? e}`);
    return false;
  }
}

/** If the store is installed in Teams and has nominated an approver, send them an
 *  Approve / Decline card. Best-effort, exactly like the Slack path: the approval
 *  request already exists in the console, and a messaging failure must never
 *  matter to the chat that triggered it.
 *
 *  Note this targets a PERSON, not a channel. Posting into the conversation where
 *  the action was raised would let the requester approve their own held action. */
async function postTeamsApproval(
  db: SupabaseClient,
  store: Store,
  reqId: string,
  detail: string,
  actedAs: string | null,
): Promise<boolean> {
  try {
    const appId = Deno.env.get("MICROSOFT_APP_ID");
    const appPassword = Deno.env.get("MICROSOFT_APP_PASSWORD");
    if (!appId || !appPassword) return false;
    // deno-lint-ignore no-explicit-any
    const from = db.from as unknown as (t: string) => any;
    const { data: install } = await from("teams_installs")
      .select("tenant_id, approvals_email")
      .eq("store_id", store.id)
      .eq("active", true)
      .maybeSingle();
    if (!install?.tenant_id || !install?.approvals_email) return false;

    const { data: approver } = await from("teams_user")
      .select("service_url, conversation_id")
      .eq("tenant_id", install.tenant_id)
      .ilike("email", String(install.approvals_email))
      .maybeSingle();
    if (!approver?.conversation_id) {
      // We have never seen them, so there is no conversation to reach them on.
      console.warn(`[holds] teams approver ${install.approvals_email} hasn't messaged the bot yet — no card sent`);
      return false;
    }

    const card = buildApprovalCard({
      id: reqId, detail, orgName: store.store_display_name ?? store.slug, actedAs,
    });
    return await postTeamsActivity(appId, appPassword, approver.service_url, approver.conversation_id, card);
  } catch (e) {
    console.warn(`[holds] teams approval post: ${(e as Error)?.message ?? e}`);
    return false;
  }
}

const PANEL_URL = (Deno.env.get("CONSOLE_URL") ?? "https://sol-assistant.vercel.app").replace(/\/$/, "");
const APPROVAL_TOPIC = "approval";

/** A compact, human-readable summary of what the held tool was asked to do.
 *  Values are the owner's own data (shown only in their console) — but capped so
 *  a large blob can't bloat the row, and stripped of obviously secret-looking
 *  keys just in case a tool declared one. */
function summarizeArgs(args: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(args ?? {})) {
    if (/token|secret|password|key|authorization/i.test(k)) continue;
    if (v === undefined || v === null || v === "") continue;
    let val = typeof v === "object" ? JSON.stringify(v) : String(v);
    if (val.length > 80) val = val.slice(0, 77) + "…";
    parts.push(`${k}: ${val}`);
    if (parts.length >= 8) break;
  }
  return parts.join("   ");
}

/**
 * Route a held write. Records an approval request, notifies the team, and returns
 * a reference + a note the model can relay truthfully. Called from the tool layer
 * only when the executor reported `held: true`.
 */
export async function routeHeldAction(
  db: SupabaseClient,
  store: Store,
  sessionId: string,
  h: { tool: string; kind: "http" | "mcp" | "m365"; actedAs: string | null; args: Record<string, unknown> },
): Promise<{ reference?: string; note: string }> {
  const argSummary = summarizeArgs(h.args);
  const detail = argSummary ? `${h.tool} — ${argSummary}` : h.tool;
  const fallbackNote =
    "That needs a person on your team to approve — I've flagged it for them. Nothing's changed.";

  try {
    // Idempotency: the model often calls a held tool on the info turn AND again on
    // the confirm turn. Collapse repeats of the same tool within the session to one
    // pending request (and skip the duplicate notification).
    const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const { data: existing } = await db
      .from("action_request")
      .select("id")
      .eq("store_id", store.id)
      .eq("session_id", sessionId)
      .eq("tool", h.tool)
      .eq("status", "pending")
      .gte("created_at", cutoff)
      .limit(1)
      .maybeSingle();
    if (existing) {
      return {
        reference: (existing as { id: string }).id,
        note: "That's already with your team to approve — nothing's changed while they review it.",
      };
    }

    const { data: inserted, error } = await db
      .from("action_request")
      .insert({
        store_id: store.id,
        session_id: sessionId,
        tool: h.tool.slice(0, 80),
        kind: h.kind,
        acted_as: h.actedAs ? h.actedAs.slice(0, 160) : null,
        detail: detail.slice(0, 600),
        // The call itself, so approving can run it. `detail` is a summary for
        // human eyes and is lossy by design; replaying from it would guess.
        args: h.args ?? {},
      })
      .select("id")
      .single();
    if (error) {
      console.error(`[holds] insert: ${error.message}`);
      return { note: fallbackNote };
    }

    // Notify the team (topic 'approval' + '*' subscribers). Best-effort.
    const orgName = store.store_display_name ?? store.slug;
    const who = h.actedAs ? `\nRequested for: ${h.actedAs}` : "";
    const summary = `Approval needed — ${orgName}\n\n${detail}${who}`;
    let notified = 0;
    try {
      notified = await notifyResponders(db, store, APPROVAL_TOPIC, summary, {
        subject: `Approval needed — ${orgName}`,
        emailBody: `${summary}\n\nReview and approve or decline: ${PANEL_URL}/activity`,
      });
    } catch (e) {
      console.error(`[holds] notify: ${e instanceof Error ? e.message : e}`);
    }

    // In-channel approval: Approve/Decline buttons in Slack, if configured.
    const reqId = (inserted as { id: string }).id;
    if (await postSlackApproval(db, store, reqId, detail, h.actedAs)) notified++;
    if (await postTeamsApproval(db, store, reqId, detail, h.actedAs)) notified++;

    // Same honesty rule as an escalation: the request is recorded and visible in
    // the console either way, but telling someone it was "flagged to your team"
    // when no person was reached leaves them waiting on a queue nobody is watching.
    // Say which of the two actually happened.
    if (notified === 0) {
      console.warn(`[holds] ${reqId}: approval request open but nobody was notified`);
      return {
        reference: reqId,
        note:
          "I've opened an approval request and nothing has changed in the meantime. Be " +
          "straight that no one is set up to receive approvals yet, so it is waiting in " +
          "the console rather than with a named person, and you cannot say when it will " +
          "be picked up.",
      };
    }
    return {
      reference: reqId,
      note:
        "I've opened an approval request for your team and flagged it - they'll review and can approve or decline it. Nothing's changed in the meantime.",
    };
  } catch (e) {
    console.error(`[holds] route: ${e instanceof Error ? e.message : e}`);
    return { note: fallbackNote };
  }
}
