// What an approval actually does.
//
// Until now, approving a held action recorded a decision and nothing else: the
// write still had to be performed by hand in the other system, and the person who
// asked for it was never told. For a product whose claim is that it can act in
// your systems safely, that made the governance loop paperwork — the "safely"
// half without the "act" half.
//
// So an approval runs the call it approved, as the person it was raised for, and
// tells them the outcome in the channel they asked from. Three things follow from
// that, and each is deliberate:
//
//   • The hold is bypassed here and ONLY here. The executors still refuse a held
//     tool unconditionally, so nothing the model says or does can reach this path;
//     the only way in is a named owner clicking approve.
//   • It acts as the original requester, not as the account. The approval means
//     "yes, do this for them" — an identity assertion minted from `acted_as` says
//     exactly that to the receiving API, and keeps the audit trail honest.
//   • Approved and completed are separate facts. A decision that stands but whose
//     run failed must not read as done, or an owner will believe an action
//     happened that did not.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Store } from "./types.ts";
import { loadHttpTools, executeHttpTool } from "./httptool.ts";
import { loadMcpTools, executeMcpTool } from "./mcp.ts";
import { logToolCall } from "./audit.ts";
import { relayToAsker } from "./responders.ts";
import { noteAssistantMessage } from "./history.ts";

export interface ResolveResult {
  ok: boolean;
  /** The decision that was recorded, whatever happened afterwards. */
  decision?: "approved" | "declined";
  /** True only when an approved action actually ran without error. */
  completed?: boolean;
  /** What happened, in one line, for the console to show. */
  note?: string;
  /** True when we got the outcome back to the person who asked. */
  told?: boolean;
  error?: string;
}

interface Row {
  id: string;
  session_id: string | null;
  tool: string;
  kind: string;
  acted_as: string | null;
  detail: string;
  args: Record<string, unknown> | null;
  status: string;
}

export async function resolveActionRequest(
  db: SupabaseClient,
  store: Store,
  id: string,
  decision: "approved" | "declined",
  by: string,
): Promise<ResolveResult> {
  // Claim it first. Scoped to this store and to still-pending, so a stale click
  // cannot flip somebody else's request or re-decide a settled one.
  const { data: claimed, error } = await db
    .from("action_request")
    .update({ status: decision, decided_by: by, decided_at: new Date().toISOString() })
    .eq("id", id)
    .eq("store_id", store.id)
    .eq("status", "pending")
    .select("id, session_id, tool, kind, acted_as, detail, args, status");
  if (error) return { ok: false, error: error.message };
  if (!claimed || claimed.length === 0) return { ok: false, error: "already resolved" };
  const req = claimed[0] as Row;

  if (decision === "declined") {
    const told = await tell(db, store, req, `About your request — ${readable(req.detail)} — that wasn't approved, so nothing has changed.`);
    return { ok: true, decision, completed: false, note: "Declined. Nothing ran.", told };
  }

  const outcome = await runApproved(db, store, req);
  await db
    .from("action_request")
    .update({ completed: outcome.completed, result_note: outcome.note.slice(0, 600) })
    .eq("id", req.id);

  const told = await tell(
    db, store, req,
    outcome.completed
      ? `Good news — your request (${readable(req.detail)}) was approved by ${by}, and it's done.`
      : `Your request (${readable(req.detail)}) was approved by ${by}, but it didn't go through: ${outcome.note}. Someone will need to look at it.`,
  );

  return { ok: true, decision, completed: outcome.completed, note: outcome.note, told };
}

/** Run the approved call, with the hold bypassed. */
async function runApproved(
  db: SupabaseClient,
  store: Store,
  req: Row,
): Promise<{ completed: boolean; note: string }> {
  const args = (req.args ?? {}) as Record<string, unknown>;
  // Act as the person it was raised for. `acted_as` was written from a
  // server-verified identity when the action was held, never from the model.
  const visitor = req.acted_as ? { email: req.acted_as, channel: channelOf(req.session_id) } : undefined;

  try {
    if (req.kind === "http") {
      const tools = await loadHttpTools(db, store.id);
      const t = tools.find((x) => x.name === req.tool);
      if (!t) return { completed: false, note: "that tool no longer exists" };
      // The ONLY place a hold is lifted, and only for this one approved call.
      const out = await executeHttpTool(db, store, { ...t, action_policy: "auto" }, args, visitor);
      return finish(db, store, req, out, "http");
    }
    if (req.kind === "mcp") {
      const tools = await loadMcpTools(db, store.id);
      const t = tools.find((x) => x.name === req.tool);
      if (!t) return { completed: false, note: "that tool no longer exists" };
      const out = await executeMcpTool(db, store, { ...t, action_policy: "auto" }, args, visitor);
      return finish(db, store, req, out, "mcp");
    }
    return { completed: false, note: `unknown tool kind: ${req.kind}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[resolve] ${req.tool}: ${msg}`);
    return { completed: false, note: "the call failed" };
  }
}

function finish(
  db: SupabaseClient,
  store: Store,
  req: Row,
  out: Record<string, unknown>,
  kind: "http" | "mcp",
): { completed: boolean; note: string } {
  const failed = !!out?.error || out?.ok === false;
  // Audited like any other call, so the log shows the action running at approval
  // time and who it ran for — not just that a request was held hours earlier.
  void logToolCall(db, store, req.session_id ?? "approval", {
    tool: req.tool, kind, actedAs: req.acted_as,
    sideEffect: true, status: failed ? "error" : "ok",
  });
  if (failed) {
    const note = typeof out?.note === "string" ? out.note : typeof out?.error === "string" ? out.error : "the system rejected it";
    return { completed: false, note };
  }
  return { completed: true, note: "done" };
}

/** The stored detail leads with the tool's own name, which is snake_case because a
 *  model reads it. A person reads this one. */
function readable(detail: string): string {
  return detail.replace(/^[a-z0-9_]+/, (m) => m.replace(/_/g, " "));
}

/** Web sessions have no channel to push to; Teams and Slack do. */
function channelOf(session: string | null): string {
  if (!session) return "web";
  if (session.startsWith("teams_")) return "teams";
  if (session.startsWith("slack_")) return "slack";
  return "web";
}

/**
 * Tell the person who asked. Best-effort: the decision and the run are already
 * recorded, and a messaging failure must not undo either.
 *
 * Teams and Slack can be pushed to. A web visitor cannot — there is no address to
 * push to and they may have closed the tab — so the message is written into their
 * conversation, where it belongs either way: it is what the assistant said to
 * them, and it is what the next turn should be aware of. `told` stays false so the
 * console does not claim they were reached.
 */
async function tell(db: SupabaseClient, store: Store, req: Row, text: string): Promise<boolean> {
  const session = req.session_id;
  if (!session) return false;
  try {
    const pushed = await relayToAsker(db, store, session, text);
    await db.from("thread_messages").insert({
      message_id: `msg_out_${crypto.randomUUID()}`,
      thread_id: `thr_${session}_${store.slug}`,
      store_slug: store.slug,
      customer_phone: session,
      direction: "outbound",
      sender: "bot",
      kind: "message",
      text,
    });
    // Also into the turn log, so the assistant's next reply knows it already said
    // this. Without it, it will happily re-check the system and contradict itself.
    await noteAssistantMessage(db, store.slug, session, text);
    return pushed;
  } catch (e) {
    console.warn(`[resolve] telling ${session}: ${(e as Error)?.message ?? e}`);
    return false;
  }
}
