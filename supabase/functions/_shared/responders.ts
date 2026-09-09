// Who gets told when a person is needed.
//
// Delivery itself lives in notify.ts, which reaches each responder on the channel
// they actually work in (Teams, then Slack, then email). This module owns the
// question of WHO: the store's active responders, filtered by the topic they
// subscribed to.
//
// The WhatsApp DM path that used to live here is gone with the channel.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Store } from "./types.ts";
import { deliverToPeople } from "./notify.ts";

/** Notify everyone subscribed to this topic. Topics are 'escalation', 'approval',
 *  and any request-type key the account defined. Delivery picks the channel. */
export async function notifyResponders(
  db: SupabaseClient,
  store: Store,
  topic: string,
  text: string,
  opts?: { subject?: string; emailBody?: string },
): Promise<void> {
  const { data } = await db
    .from("store_responders")
    .select("email, name")
    .eq("store_slug", store.slug)
    .eq("active", true)
    .or(`topics.cs.{${topic}},topics.cs.{*}`);
  const rows = (data ?? []) as { email: string | null; name: string | null }[];
  await deliverToPeople(db, store, rows, text, opts);
}

/**
 * Answer a SPECIFIC ticket from the dashboard (any owner/staff, incl. email-only
 * responders who can't reply over WhatsApp). Same delivery as a WhatsApp reply.
 */
export async function answerTicket(
  db: SupabaseClient,
  store: Store,
  ticketId: string,
  answerText: string,
  by: string,
): Promise<{ handled: boolean; note?: string }> {
  const { data: t } = await db
    .from("tickets")
    .select("ticket_id, customer_phone, question, status")
    .eq("store_slug", store.slug)
    .eq("ticket_id", ticketId)
    .maybeSingle();
  if (!t) return { handled: false, note: "not_found" };
  if (t.status !== "created" && t.status !== "sent_to_owner") {
    return { handled: false, note: "already_answered" };
  }
  return await deliverTicketAnswer(db, store, t, answerText, by, null);
}

/** Shared: atomically claim the ticket (first-to-answer wins across WhatsApp and
 *  the panel), relay to the customer, persist, learn, and notify the team. */
async function deliverTicketAnswer(
  db: SupabaseClient,
  store: Store,
  ticket: { ticket_id: string; customer_phone: string | null; question: string | null },
  answerText: string,
  by: string,
  excludePhone: string | null,
): Promise<{ handled: boolean; note?: string }> {
  const { data: claimed } = await db
    .from("tickets")
    .update({ status: "answered", answer: answerText, answered_by: by, answered_at: new Date().toISOString() })
    .eq("ticket_id", ticket.ticket_id)
    .in("status", ["created", "sent_to_owner"])
    .select("ticket_id");
  if (!claimed || claimed.length === 0) return { handled: false, note: "already_answered" };

  // Relay to the customer as Rani. Web sessions (customer_phone = web_<uuid>)
  // have no phone — the thread write below is delivered live via Realtime instead.
  const isWeb = (ticket.customer_phone ?? "").startsWith("web_");
  const token = await getStoreAccessToken(db, store.id);
  if (token && ticket.customer_phone && !isWeb && store.whatsapp_phone_number_id) {
    await sendText(token, store.whatsapp_phone_number_id, ticket.customer_phone, answerText);
  }

  const threadId = `thr_${ticket.customer_phone}_${store.slug}`;
  await db.from("thread_messages").insert({
    message_id: `msg_out_${crypto.randomUUID()}`,
    thread_id: threadId, store_slug: store.slug, customer_phone: ticket.customer_phone,
    direction: "outbound", sender: by, text: answerText, kind: "message",
  });
  await db.from("thread_messages").insert({
    message_id: `evt_${crypto.randomUUID()}`,
    thread_id: threadId, store_slug: store.slug, customer_phone: ticket.customer_phone,
    direction: "system", sender: "bot", kind: "event", event_type: "ticket_answered",
    text: `${by} answered: ${ticket.question}`, event_payload_json: { ticket_id: ticket.ticket_id, by },
  });

  // Learn from this answer (best-effort; never blocks the relay).
  try {
    await learnFromAnswer(db, store, ticket.question ?? "", answerText, ticket.customer_phone);
  } catch (e) {
    console.error(`[responders] learn: ${e instanceof Error ? e.message : e}`);
  }

  // Tell the other responders it's handled.
  let others = db
    .from("store_responders")
    .select("phone")
    .eq("store_slug", store.slug)
    .eq("active", true)
    .eq("notify_escalations", true);
  if (excludePhone) others = others.neq("phone", excludePhone);
  const { data: rest } = await others;
  await notify(
    db, store,
    (rest ?? []).map((r: { phone: string | null }) => r.phone).filter((p): p is string => !!p),
    `Handled: "${ticket.question}" — answered by ${by}.`,
  );

  return { handled: true };
}
