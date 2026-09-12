// run-triggers — the assistant doing work nobody asked for, on purpose.
//
// pg_cron pings this every five minutes. It claims whatever is due, runs each
// standing instruction through exactly the path a typed message takes, and
// records what happened.
//
// Three things are deliberate:
//
//   • A run goes through generateTurnReply, not around it. Same knowledge, same
//     tools, same holds. A scheduled path with its own shortcut to the executors
//     would be a second door into the same systems with none of the locks, and
//     it would be the door nobody remembered to audit.
//   • It acts as a NAMED person (trigger.runs_as), so a held action reaches an
//     approver, an identity assertion says whose authority was borrowed, and the
//     log reads the same as if they had asked themselves. "The system did it" is
//     not an answer anyone can act on.
//   • Runs are not conversations. They are recorded in agent_run and kept out of
//     the `conversations` table, because the health and discovery figures on Home
//     answer "what are PEOPLE asking" — folding in the assistant talking to
//     itself every hour would quietly corrupt the one page meant to be trusted.
//
// verify_jwt is off: pg_net posts with no user. Safe because the function takes
// no input — it can only ever do what an owner already scheduled.

import { serviceClient } from "../_shared/supabase.ts";
import { getStoreById } from "../_shared/config.ts";
import { generateTurnReply } from "../_shared/conversation.ts";
import { loadAgentConfig } from "../_shared/agent.ts";
import { nextRun } from "../_shared/schedule.ts";

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

/** Small, because a slow tool call shouldn't let one account's backlog starve
 *  everyone else's. The next tick is five minutes away. */
const MAX_PER_RUN = 10;

type Trigger = {
  id: string;
  store_id: string;
  name: string;
  instruction: string;
  schedule: "hourly" | "daily" | "weekdays";
  at_hour: number;
  runs_as: string;
};

Deno.serve(async () => {
  const db = serviceClient();
  const now = new Date();

  const { data: due, error } = await db
    .from("agent_trigger")
    .select("id, store_id, name, instruction, schedule, at_hour, runs_as")
    .eq("active", true)
    .lte("next_run_at", now.toISOString())
    .limit(MAX_PER_RUN);
  if (error) {
    console.error("[run-triggers] load:", error.message);
    return json({ error: error.message }, 500);
  }

  let ran = 0;
  for (const t of (due ?? []) as Trigger[]) {
    try {
      const store = await getStoreById(db, t.store_id);
      if (!store) continue;
      const config = await loadAgentConfig(db, store);
      const tz = config.timezone || "UTC";

      // Claim it by moving next_run_at forward BEFORE doing any work, conditional
      // on it still being due. A second tick that overlaps this one updates zero
      // rows and moves on, so a slow run cannot be started twice.
      const { data: claimed } = await db
        .from("agent_trigger")
        .update({
          next_run_at: nextRun(now, t.schedule, t.at_hour, tz).toISOString(),
          last_run_at: now.toISOString(),
        })
        .eq("id", t.id)
        .lte("next_run_at", now.toISOString())
        .select("id");
      if (!claimed || claimed.length === 0) continue;

      const sessionId = `trigger_${t.id}_${now.getTime()}`;
      const started = new Date().toISOString();
      let status: "ok" | "held" | "error" = "ok";
      let detail = "";
      let toolsUsed = 0;

      try {
        const reply = await generateTurnReply(db, store, {
          sessionId,
          inboundText: t.instruction,
          visitor: { channel: "schedule", email: t.runs_as },
        });
        detail = reply.text ?? "";
        toolsUsed = reply.toolsUsed?.length ?? 0;
      } catch (e) {
        status = "error";
        detail = e instanceof Error ? e.message : String(e);
        console.error(`[run-triggers] ${t.name}:`, detail);
      }

      // Anything it tried that needs sign-off. Counted from the record rather
      // than inferred from the reply, because the assistant describing what it
      // did is not evidence that it did it.
      const { count: held } = await db
        .from("action_request")
        .select("id", { count: "exact", head: true })
        .eq("store_id", store.id)
        .eq("session_id", sessionId);
      if (status === "ok" && (held ?? 0) > 0) status = "held";

      await db.from("agent_run").insert({
        store_id: store.id,
        trigger_id: t.id,
        trigger_name: t.name,
        runs_as: t.runs_as,
        started_at: started,
        finished_at: new Date().toISOString(),
        status,
        detail: detail.slice(0, 4000),
        tools_used: toolsUsed,
        actions_held: held ?? 0,
      });
      ran++;
    } catch (e) {
      console.error(`[run-triggers] ${t.id}:`, e instanceof Error ? e.message : e);
    }
  }

  return json({ ok: true, considered: due?.length ?? 0, ran });
});
