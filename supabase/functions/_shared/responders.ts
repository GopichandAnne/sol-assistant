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
import { learnFromAnswer } from "./learn.ts";
import { slackPostMessage } from "./slack-api.ts";
import { postTeamsReply } from "./teams-auth.ts";

/**
 * Notify everyone subscribed to this topic. Topics are 'escalation', 'approval',
 * and any request-type key the account defined. Delivery picks the channel.
 *
 * Falls back to the account's owners and admins when no responder is subscribed.
 * A brand-new assistant has an empty responder list, and the first time it needs
 * a person is exactly when nobody has thought to configure one — so the default
 * is "tell whoever owns this account" rather than "tell nobody".
 *
 * Returns how many people were actually reached, so a caller can be honest about
 * whether a handoff happened.
 */
export async function notifyResponders(
  db: SupabaseClient,
  store: Store,
  topic: string,
  text: string,
  opts?: { subject?: string; emailBody?: string },
): Promise<number> {
  const { data } = await db
    .from("store_responders")
    .select("email, name")
    .eq("store_slug", store.slug)
    .eq("active", true)
    .or(`topics.cs.{${topic}},topics.cs.{*}`);
  let rows = (data ?? []) as { email: string | null; name: string | null }[];

  if (rows.length === 0) {
    rows = await accountOwners(db, store);
    if (rows.length > 0) {
      console.log(`[responders] ${store.slug}: no responder for '${topic}' — falling back to ${rows.length} account owner(s)`);
    }
  }

  return await deliverToPeople(db, store, rows, text, opts);
}

/** The account's owners and admins, by their sign-in email. Resolved in the
 *  database (company_alert_target is SECURITY DEFINER) because the edge role
 *  cannot read auth.users, and an owner's address is the only universal fallback:
 *  every account has one, unlike a responder list or a channel install. */
async function accountOwners(db: SupabaseClient, store: Store): Promise<{ email: string | null; name: string | null }[]> {
  try {
    const { data, error } = await db.rpc("company_alert_target", { p_store_id: store.id });
    if (error || !data) return [];
    const emails = (data as { emails?: unknown }).emails;
    if (!Array.isArray(emails)) return [];
    return emails
      .filter((e): e is string => typeof e === "string" && e.includes("@"))
      .map((email) => ({ email, name: null }));
  } catch (e) {
    console.warn(`[responders] owner lookup failed: ${(e as Error)?.message ?? e}`);
    return [];
  }
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

/**
 * Claim the ticket (first answer wins), send the answer back to the person who
 * asked, record it, and learn from it.
 *
 * The relay is the half that makes escalation worth having: an answer that only
 * lands in the console is a ticket, not a reply. So it goes back on the channel
 * the person was using when they asked, which the session id tells us --
 * `teams_<tenant>_<user>`, `slack_<team>_<user>`, or `web_<id>`. Web needs no
 * send: the thread write below reaches the open widget over Realtime.
 *
 * Best-effort per channel. A messaging failure still leaves the answer recorded
 * and the ticket closed, and `relayed` says which of those happened.
 */
async function deliverTicketAnswer(
  db: SupabaseClient,
  store: Store,
  ticket: { ticket_id: string; customer_phone: string | null; question: string | null },
  answerText: string,
  by: string,
  _excluded: string | null,
): Promise<{ handled: boolean; note?: string; relayed?: boolean }> {
  const { data: claimed } = await db
    .from("tickets")
    .update({ status: "answered", answer: answerText, answered_by: by, answered_at: new Date().toISOString() })
    .eq("ticket_id", ticket.ticket_id)
    .in("status", ["created", "sent_to_owner"])
    .select("ticket_id");
  if (!claimed || claimed.length === 0) return { handled: false, note: "already_answered" };

  const session = ticket.customer_phone ?? "";
  const relayed = await relayToAsker(db, store, session, answerText);

  const threadId = `thr_${session}_${store.slug}`;
  await db.from("thread_messages").insert({
    message_id: `msg_out_${crypto.randomUUID()}`,
    thread_id: threadId, store_slug: store.slug, customer_phone: session,
    direction: "outbound", sender: by, text: answerText, kind: "message",
  });
  await db.from("thread_messages").insert({
    message_id: `evt_${crypto.randomUUID()}`,
    thread_id: threadId, store_slug: store.slug, customer_phone: session,
    direction: "system", sender: "bot", kind: "event", event_type: "ticket_answered",
    text: `${by} answered: ${ticket.question}`, event_payload_json: { ticket_id: ticket.ticket_id, by, relayed },
  });

  // Learn from this answer so the next person gets it straight away. Best-effort;
  // never blocks the relay.
  try {
    await learnFromAnswer(db, store, ticket.question ?? "", answerText, session);
  } catch (e) {
    console.error(`[responders] learn: ${e instanceof Error ? e.message : e}`);
  }

  // Tell the rest of the team it is handled, so two people do not answer the same
  // thing. Same topic subscription and same channel resolution as the original
  // escalation, minus the person who just answered it.
  try {
    const { data: rest } = await db
      .from("store_responders")
      .select("email, name")
      .eq("store_slug", store.slug)
      .eq("active", true)
      .or("topics.cs.{escalation},topics.cs.{*}");
    const others = ((rest ?? []) as { email: string | null; name: string | null }[])
      .filter((r) => r.email && r.email.toLowerCase() !== by.toLowerCase());
    if (others.length > 0) {
      await deliverToPeople(
        db, store, others,
        `Handled -- "${ticket.question}" was answered by ${by}. Nothing needed from you.`,
        { subject: `Handled -- ${store.store_display_name ?? store.slug}` },
      );
    }
  } catch (e) {
    console.warn(`[responders] handled-notice: ${e instanceof Error ? e.message : e}`);
  }

  return { handled: true, relayed };
}

/** Push the answer back to the person on the channel they asked from. Returns
 *  false when we could not reach them there, which for web is the normal case:
 *  the widget picks the answer up from the thread over Realtime instead. */
async function relayToAsker(
  db: SupabaseClient,
  store: Store,
  session: string,
  answerText: string,
): Promise<boolean> {
  // deno-lint-ignore no-explicit-any
  const from = db.from as unknown as (t: string) => any;
  try {
    if (session.startsWith("slack_")) {
      // slack_<teamId>_<userId>. A user id is a valid channel for postMessage, so
      // this arrives as a DM from the assistant they were already talking to.
      const rest = session.slice("slack_".length);
      const cut = rest.indexOf("_");
      if (cut < 0) return false;
      const userId = rest.slice(cut + 1);
      const { data: install } = await from("slack_installs")
        .select("bot_token").eq("store_id", store.id).eq("active", true).maybeSingle();
      if (!install?.bot_token || !userId) return false;
      return await slackPostMessage(install.bot_token, userId, answerText);
    }

    if (session.startsWith("teams_")) {
      // teams_<tenantId>_<aadObjectId|teamsUserId>. We can only post into a
      // conversation Bot Framework has handed us, which is what teams_user stores.
      const appId = Deno.env.get("MICROSOFT_APP_ID");
      const appPassword = Deno.env.get("MICROSOFT_APP_PASSWORD");
      if (!appId || !appPassword) return false;
      const rest = session.slice("teams_".length);
      const cut = rest.indexOf("_");
      if (cut < 0) return false;
      const tenantId = rest.slice(0, cut);
      const who = rest.slice(cut + 1);
      const { data: u } = await from("teams_user")
        .select("service_url, conversation_id")
        .eq("tenant_id", tenantId)
        .or(`aad_object_id.eq.${who},teams_user_id.eq.${who}`)
        .maybeSingle();
      if (!u?.conversation_id) return false;
      return await postTeamsReply(appId, appPassword, u.service_url, u.conversation_id, answerText);
    }
  } catch (e) {
    console.warn(`[responders] relay to ${session}: ${(e as Error)?.message ?? e}`);
    return false;
  }
  return false; // web: delivered by the thread write, over Realtime
}
