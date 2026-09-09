// Where a message to a HUMAN goes.
//
// Escalations, held actions waiting on approval, and captured requests all need
// to reach a person. Upstream that meant a WhatsApp DM, because the product lived
// on WhatsApp. This one lives in Teams and Slack, so a notification should arrive
// where that person already works, and fall back to email when it cannot.
//
// One message per person, not one per channel. Nobody wants the same escalation
// in Teams and in Slack and in their inbox: that is how people learn to ignore
// notifications. So each responder is reached on the best channel available TO
// THEM, and email is the floor rather than a duplicate.
//
// Resolution order per responder:
//   1. Teams   — if the account is installed and they have messaged the bot
//   2. Slack   — if the workspace is connected and their email matches a member
//   3. Email   — always available, and the default the product ships with
//
// Best-effort throughout. A notification failing must never affect the reply the
// person on the other end of the chat is waiting for.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Store } from "./types.ts";
import { sendEmail } from "./email.ts";
import { slackLookupByEmail, slackPostMessage } from "./slack-api.ts";
import { postTeamsReply } from "./teams-auth.ts";

// Where a notified person goes to act on it. Configuration, not a constant: this
// product has its own console, and pointing people at another product's URL is
// how a carve-out leaks back into the thing it was carved out of.
const PANEL_URL = (Deno.env.get("CONSOLE_URL") ?? "https://sol-assistant.vercel.app").replace(/\/$/, "");

export interface Recipient {
  email: string | null;
  name: string | null;
}

interface Reach {
  teams?: { tenantId: string; appId: string; appPassword: string };
  slack?: { botToken: string };
}

/** Load, once per notification, what this account can reach people through. */
async function loadReach(db: SupabaseClient, store: Store): Promise<Reach> {
  const reach: Reach = {};
  // deno-lint-ignore no-explicit-any
  const from = db.from as unknown as (t: string) => any;

  const appId = Deno.env.get("MICROSOFT_APP_ID");
  const appPassword = Deno.env.get("MICROSOFT_APP_PASSWORD");
  if (appId && appPassword) {
    try {
      const { data } = await from("teams_installs")
        .select("tenant_id").eq("store_id", store.id).eq("active", true).maybeSingle();
      if (data?.tenant_id) reach.teams = { tenantId: data.tenant_id, appId, appPassword };
    } catch { /* best-effort */ }
  }

  try {
    const { data } = await from("slack_installs")
      .select("bot_token").eq("store_id", store.id).eq("active", true).maybeSingle();
    if (data?.bot_token) reach.slack = { botToken: data.bot_token };
  } catch { /* best-effort */ }

  return reach;
}

/** Try Teams. Only possible for someone who has messaged the bot, because that is
 *  when Bot Framework hands us a conversation to post into. */
async function viaTeams(db: SupabaseClient, reach: Reach, email: string, text: string): Promise<boolean> {
  if (!reach.teams || !email) return false;
  try {
    // deno-lint-ignore no-explicit-any
    const from = db.from as unknown as (t: string) => any;
    const { data } = await from("teams_user")
      .select("service_url, conversation_id")
      .eq("tenant_id", reach.teams.tenantId)
      .ilike("email", email)
      .maybeSingle();
    if (!data?.conversation_id) return false;
    return await postTeamsReply(
      reach.teams.appId, reach.teams.appPassword, data.service_url, data.conversation_id, text,
    );
  } catch {
    return false;
  }
}

/** Try Slack. A user id works as a channel for chat.postMessage, so this is a DM. */
async function viaSlack(reach: Reach, email: string, text: string): Promise<boolean> {
  if (!reach.slack || !email) return false;
  try {
    const userId = await slackLookupByEmail(reach.slack.botToken, email);
    if (!userId) return false;
    return await slackPostMessage(reach.slack.botToken, userId, text);
  } catch {
    return false;
  }
}

/**
 * Send one message to each recipient, on the best channel available to them.
 *
 * `text` is written as if the assistant is speaking, because that is what the
 * person sees: a message from the assistant they already know, not a system
 * alert from an address nobody recognises.
 *
 * Returns how many people were actually reached. Callers need that number rather
 * than a promise that resolved: an assistant that says "I've passed this to the
 * team" when nothing was sent is worse than one that says nobody is set up yet,
 * because the person stops waiting for a reply that will never come.
 */
export async function deliverToPeople(
  db: SupabaseClient,
  store: Store,
  recipients: Recipient[],
  text: string,
  opts?: { subject?: string; emailBody?: string },
): Promise<number> {
  const people = recipients.filter((r) => r.email);
  if (people.length === 0) {
    console.warn(`[notify] ${store.slug}: nobody reachable — no responder has an email`);
    return 0;
  }

  const reach = await loadReach(db, store);
  const name = store.store_display_name ?? store.slug;
  const subject = opts?.subject ?? `Someone needs a hand — ${name}`;
  const body = opts?.emailBody ?? `${text}\n\nOpen the console to respond: ${PANEL_URL}/tickets`;

  let reached = 0;
  for (const person of people) {
    const email = person.email!;
    if (await viaTeams(db, reach, email, text)) { reached++; continue; }
    if (await viaSlack(reach, email, text)) { reached++; continue; }
    if (await sendEmail(email, subject, body, name)) reached++;
  }
  if (reached === 0) {
    console.warn(
      `[notify] ${store.slug}: ${people.length} responder(s) but none reachable — ` +
      `no Teams or Slack install and no SMTP configured`,
    );
  }
  return reached;
}
