"use server";

import { revalidatePath } from "next/cache";
import { getActiveStore } from "@/lib/store/active-store";
import { createClient } from "@/lib/supabase/server";
import { callBotAdmin } from "@/lib/knowledge/bot-admin";

export type AnswerResult = { ok: true; relayed?: boolean } | { ok: false; error: string };

/**
 * Answer an escalation from the console. Anyone on the assistant's team can, so
 * whoever knows the answer is not blocked on whoever owns the account.
 *
 * The answer goes back to the person who asked on the channel they asked from —
 * a DM in Teams or Slack, or the open web chat over Realtime — the ticket is
 * closed, the assistant learns from it so the next person gets it straight away,
 * and the rest of the team is told it is handled.
 */
export async function answerTicket(ticketId: string, answer: string): Promise<AnswerResult> {
  const ctx = await getActiveStore();
  if (!ctx?.active) return { ok: false, error: "No active store." };
  const a = answer.trim();
  if (!a) return { ok: false, error: "Write an answer first." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const by = user?.email || "The team";

  const res = await callBotAdmin({
    action: "answer_ticket",
    store_slug: ctx.active.slug,
    ticket_id: ticketId,
    answer: a,
    by,
  });
  if (!res.ok) return { ok: false, error: res.error };

  const data = res.data as { handled?: boolean; note?: string; relayed?: boolean };
  if (!data.handled) {
    const msg =
      data.note === "already_answered"
        ? "Someone on the team already answered that one."
        : data.note === "not_found"
          ? "Ticket not found."
          : "Couldn't send the answer.";
    return { ok: false, error: msg };
  }
  revalidatePath("/inbox");
  return { ok: true, relayed: data.relayed === true };
}
