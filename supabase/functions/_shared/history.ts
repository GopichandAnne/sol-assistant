// Load prior conversation turns for a session — Bot Phase 2.
// Reads the analytics turn log (conversations), newest-first capped at the
// store's history_turns, then reverses to oldest-first and shapes into Gemini
// contents. The CURRENT inbound is not here yet (it's logged after the reply),
// so this returns strictly prior context.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { type Content, shapeHistory } from "./prompt.ts";

export async function loadHistory(
  db: SupabaseClient,
  storeSlug: string,
  sessionId: string,
  limit: number,
): Promise<Content[]> {
  const { data, error } = await db
    .from("conversations")
    .select("user_message, assistant_response, created_at")
    .eq("store_slug", storeSlug)
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error(`[history] load ${sessionId}: ${error.message}`);
    return [];
  }
  // newest-first -> oldest-first for chronological context
  const rows = (data ?? []).slice().reverse();
  return shapeHistory(rows);
}

/**
 * Record something the assistant said OUTSIDE a turn, so the next turn knows it.
 *
 * The history the model sees is the turn log, which only has rows for
 * question-and-answer pairs. Everything the assistant says between turns — a
 * colleague's answer relayed back to whoever asked, the outcome of an action a
 * person approved — was invisible to it. So it would re-check a system it had
 * already reported on, and contradict a message it had just sent.
 *
 * A row with no user message is exactly that: the assistant spoke, unprompted.
 * shapeHistory folds it into the preceding model turn.
 */
export async function noteAssistantMessage(
  db: SupabaseClient,
  storeSlug: string,
  sessionId: string,
  text: string,
): Promise<void> {
  if (!sessionId || !text) return;
  try {
    await db.from("conversations").insert({
      conversation_id: `oob_${crypto.randomUUID()}`,
      store_slug: storeSlug,
      session_id: sessionId,
      timestamp: new Date().toISOString(),
      user_message: null,
      assistant_response: text.slice(0, 4000),
    });
  } catch (e) {
    console.warn(`[history] note out-of-band: ${(e as Error)?.message ?? e}`);
  }
}
