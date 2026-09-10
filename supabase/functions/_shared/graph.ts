// Microsoft 365, through the Graph API.
//
// This is the connector that decides whether "your team stops opening ten
// applications" is a claim or a slogan, because for most organisations those ten
// applications are mostly one: mail, calendar, files in SharePoint and OneDrive,
// the staff directory, tasks.
//
// The design rule that runs through the whole file is WHOSE ACCOUNT a call goes
// out as, and it splits the tools cleanly in two:
//
//   Shared     A document in SharePoint, a colleague in the directory. The answer
//              does not depend on who is asking, so these use the organisation's
//              connection, made once by an owner.
//
//   Personal   My mail, my calendar, my tasks, mail sent as me. These use THAT
//              PERSON'S own connection and nothing else. There is no fallback to
//              the organisation's token, because the fallback is the bug: it would
//              answer "find my email from Finance" out of somebody else's mailbox.
//
// A person with no connection of their own gets an offer to make one, not a
// borrowed answer. That is also why the personal tools are only attached for
// someone the channel has actually identified.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Store } from "./types.ts";
import { consentUrl, getAccessToken, grantedScopes, personalConnectUrl } from "./connections.ts";

const GRAPH = "https://graph.microsoft.com/v1.0";
const TIMEOUT_MS = 8000;
const MAX_ITEMS = 5;

type Json = Record<string, unknown>;

/**
 * Capabilities, and what each one costs in permissions.
 *
 * Connecting asks only for Microsoft's low-impact set, which a person can approve
 * for themselves under the tenant policy most organisations run. Everything below
 * is asked for the first time somebody actually uses it — with the reason visible,
 * at the moment it matters.
 *
 * That ordering is the whole point. Asking for "read all your files, read your
 * mail and send mail as you" on a consent screen before the assistant has done
 * anything useful is how a connector gets refused; asking for mail access when
 * someone has just said "find the email about the renewal" is a question that
 * answers itself. It also means a client gets a working assistant on day one
 * while the heavier permissions are still going through their IT.
 *
 * mail and mail_send are deliberately separate. Reading a mailbox and sending in
 * someone's name are different risks, and a security review will treat them
 * differently — so an organisation can grant one without the other.
 */
export const M365_BUNDLES = {
  directory: { scopes: [] as string[], label: "Find people", why: "Look someone up in the staff directory." },
  documents: {
    scopes: ["Files.Read.All", "Sites.Read.All"],
    label: "Find documents",
    why: "Search SharePoint and OneDrive for a file, a policy or a template.",
  },
  calendar: {
    scopes: ["Calendars.ReadWrite"],
    label: "Calendar",
    why: "See what is on someone's day, check availability and book meetings.",
  },
  mail: { scopes: ["Mail.Read"], label: "Find mail", why: "Search a person's own mailbox for a message." },
  mail_send: { scopes: ["Mail.Send"], label: "Send mail", why: "Send an email from a person's own mailbox, in their name." },
  tasks: { scopes: ["Tasks.ReadWrite"], label: "Tasks", why: "Read and add tasks in a person's Microsoft To Do." },
} as const;

export type M365Bundle = keyof typeof M365_BUNDLES;

/** Which capabilities a connection can actually perform right now. */
export async function enabledBundles(
  db: SupabaseClient, storeId: string, userKey = "",
): Promise<M365Bundle[]> {
  const have = new Set(await grantedScopes(db, storeId, "microsoft", userKey));
  return (Object.keys(M365_BUNDLES) as M365Bundle[])
    .filter((b) => M365_BUNDLES[b].scopes.every((s) => have.has(s)));
}

/**
 * Check a capability, and when it is missing produce the link that adds it.
 *
 * The link asks for everything already granted plus the new bundle, so adding a
 * capability never silently narrows the connection that was working before.
 */
async function requireBundle(
  db: SupabaseClient, storeId: string, bundle: M365Bundle, userKey: string,
): Promise<{ ok: true } | { ok: false; offer: Json }> {
  const need = M365_BUNDLES[bundle].scopes;
  if (need.length === 0) return { ok: true };
  const have = await grantedScopes(db, storeId, "microsoft", userKey);
  if (need.every((s) => have.includes(s))) return { ok: true };

  const url = await consentUrl("microsoft", storeId, userKey, [...new Set([...have, ...need])]);
  const spec = M365_BUNDLES[bundle];
  const forOrg = !userKey;
  return {
    ok: false,
    offer: {
      ok: false,
      needs_permission: bundle,
      ...(url ? { approve_url: url } : {}),
      note: url
        ? `Microsoft 365 is connected, but "${spec.label}" hasn't been approved yet. ${spec.why} ` +
          (forOrg
            ? "Give the approve_url to whoever administers this assistant — it takes one approval, once, for the whole organisation. Do not claim to have looked."
            : "Share the approve_url exactly as given: it takes one approval and only affects their own account. Do not claim to have looked.") +
          " Say plainly which capability is missing and why you needed it."
        : `"${spec.label}" hasn't been approved for Microsoft 365 here, and I can't produce an approval link. Ask whoever set this up.`,
    },
  };
}

/** One Graph call. Never throws: a connector failing is an answer the assistant
 *  has to give truthfully, not an exception that loses the turn. */
async function graph(
  token: string,
  path: string,
  init: RequestInit = {},
  extraHeaders: Record<string, string> = {},
): Promise<{ ok: true; data: Json } | { ok: false; status: number; note: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(path.startsWith("http") ? path : `${GRAPH}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...extraHeaders,
      },
    });
    if (res.status === 204) return { ok: true, data: {} };
    const text = await res.text();
    if (!res.ok) {
      // 403 here almost always means the tenant did not grant that scope, which is
      // a setup answer rather than a failure — say which so it can be fixed.
      const note = res.status === 403 || res.status === 401
        ? "Microsoft 365 refused that — the connected account may not have been granted this permission."
        : "Microsoft 365 couldn't complete that request.";
      console.warn(`[graph] ${path} -> HTTP ${res.status}: ${text.slice(0, 200)}`);
      return { ok: false, status: res.status, note };
    }
    return { ok: true, data: text ? JSON.parse(text) as Json : {} };
  } catch (e) {
    console.warn(`[graph] ${path}: ${(e as Error)?.message ?? e}`);
    return { ok: false, status: 0, note: "Microsoft 365 didn't respond in time." };
  } finally {
    clearTimeout(timer);
  }
}

/* ── shared: the organisation's connection ─────────────────────────────────── */

/**
 * Find a document anywhere the connected account can see — OneDrive, SharePoint,
 * Teams files. Uses the Graph search endpoint rather than a drive-specific one so
 * a single query covers every site instead of only the one somebody guessed.
 */
export async function findDocument(
  db: SupabaseClient, store: Store, query: string,
): Promise<Json> {
  const token = await getAccessToken(db, store.id, "microsoft");
  if (!token) return { ok: false, note: "Microsoft 365 isn't connected for this assistant." };
  const allowed = await requireBundle(db, store.id, "documents", "");
  if (!allowed.ok) return allowed.offer;

  const res = await graph(token, "/search/query", {
    method: "POST",
    body: JSON.stringify({
      requests: [{
        entityTypes: ["driveItem"],
        query: { queryString: query },
        from: 0,
        size: MAX_ITEMS,
      }],
    }),
  });
  if (!res.ok) return { ok: false, note: res.note };

  // The search response nests results several levels deep; flatten to the few
  // fields a person actually needs to decide whether it is the right document.
  const containers = ((res.data.value as Json[] | undefined) ?? [])
    .flatMap((v) => (v.hitsContainers as Json[] | undefined) ?? []);
  const hits = containers.flatMap((c) => (c.hits as Json[] | undefined) ?? []);
  const docs = hits.slice(0, MAX_ITEMS).map((h) => {
    const r = (h.resource ?? {}) as Json;
    const by = ((r.lastModifiedBy as Json | undefined)?.user as Json | undefined)?.displayName;
    return {
      name: r.name ?? "(untitled)",
      link: r.webUrl ?? null,
      modified: r.lastModifiedDateTime ?? null,
      modified_by: by ?? null,
      summary: h.summary ?? null,
    };
  });

  if (docs.length === 0) return { ok: true, found: 0, note: "Nothing in Microsoft 365 matched that." };
  return { ok: true, found: docs.length, documents: docs };
}

/**
 * Look up a colleague in the staff directory.
 *
 * Job title and department need User.Read.All, which requires a tenant admin. So
 * this asks for them and, if the tenant refused that scope, falls back to the
 * basic profile rather than returning nothing — a name and an address is still
 * the answer to "who do I ask about payroll".
 */
export async function findPerson(
  db: SupabaseClient, store: Store, query: string,
): Promise<Json> {
  const token = await getAccessToken(db, store.id, "microsoft");
  if (!token) return { ok: false, note: "Microsoft 365 isn't connected for this assistant." };

  const q = encodeURIComponent(`"displayName:${query}" OR "mail:${query}"`);
  const rich = `/users?$search=${q}&$top=${MAX_ITEMS}&$select=displayName,mail,userPrincipalName,jobTitle,department,officeLocation`;
  const basic = `/users?$search=${q}&$top=${MAX_ITEMS}&$select=displayName,mail,userPrincipalName`;
  const headers = { ConsistencyLevel: "eventual" };

  let res = await graph(token, rich, {}, headers);
  if (!res.ok) res = await graph(token, basic, {}, headers);
  if (!res.ok) return { ok: false, note: res.note };

  const people = ((res.data.value as Json[] | undefined) ?? []).map((u) => ({
    name: u.displayName ?? null,
    email: u.mail ?? u.userPrincipalName ?? null,
    title: u.jobTitle ?? null,
    department: u.department ?? null,
    office: u.officeLocation ?? null,
  }));
  if (people.length === 0) return { ok: true, found: 0, note: "Nobody in the directory matched that." };
  return { ok: true, found: people.length, people };
}

/* ── personal: this person's own connection ───────────────────────────────── */

/** Resolve the asking person's token AND the capability being used, or an offer to
 *  fix whichever is missing. Every personal tool starts here, and none of them
 *  proceeds without it — so there is exactly one place where "can this person do
 *  this" is decided. */
async function personal(
  db: SupabaseClient, store: Store, email: string | null | undefined, bundle: M365Bundle,
): Promise<{ token: string } | { offer: Json }> {
  const who = (email ?? "").trim().toLowerCase();
  if (!who) {
    return { offer: { ok: false, note: "I can't tell who you are here, so I can't look at your own Microsoft 365." } };
  }
  const token = await getAccessToken(db, store.id, "microsoft", who);
  if (token) {
    const allowed = await requireBundle(db, store.id, bundle, who);
    return allowed.ok ? { token } : { offer: allowed.offer };
  }

  const url = await personalConnectUrl("microsoft", store.id, who);
  if (!url) {
    return { offer: { ok: false, note: "Microsoft 365 isn't set up for this assistant yet." } };
  }
  return {
    offer: {
      ok: false,
      needs_connection: true,
      connect_url: url,
      note:
        "You haven't connected your own Microsoft 365 account yet, so I can't see your mail, " +
        "calendar or tasks. Share the connect_url with them exactly as given and say it takes " +
        "about fifteen seconds and only they can see the result. Do not claim to have looked.",
    },
  };
}

/** What is on this person's calendar for a day. */
export async function mySchedule(
  db: SupabaseClient, store: Store, email: string | null | undefined, day?: string,
): Promise<Json> {
  const p = await personal(db, store, email, "calendar");
  if ("offer" in p) return p.offer;

  const base = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Date(`${day}T00:00:00Z`) : new Date();
  const start = new Date(base); start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start); end.setUTCDate(end.getUTCDate() + 1);

  const path =
    `/me/calendarView?startDateTime=${start.toISOString()}&endDateTime=${end.toISOString()}` +
    `&$orderby=start/dateTime&$top=20&$select=subject,start,end,location,organizer,isAllDay,onlineMeetingUrl`;
  const tz = await storeTimezone(db, store.id);
  const res = await graph(p.token, path, {}, { Prefer: `outlook.timezone="${tz}"` });
  if (!res.ok) return { ok: false, note: res.note };

  const events = ((res.data.value as Json[] | undefined) ?? []).map((e) => ({
    subject: e.subject ?? "(no subject)",
    starts: ((e.start as Json | undefined)?.dateTime as string | undefined) ?? null,
    ends: ((e.end as Json | undefined)?.dateTime as string | undefined) ?? null,
    all_day: e.isAllDay ?? false,
    where: ((e.location as Json | undefined)?.displayName as string | undefined) ?? null,
    organiser: (((e.organizer as Json | undefined)?.emailAddress as Json | undefined)?.name as string | undefined) ?? null,
    online: !!e.onlineMeetingUrl,
  }));
  return { ok: true, day: start.toISOString().slice(0, 10), count: events.length, events };
}

/** Search this person's own mailbox. */
export async function searchMyMail(
  db: SupabaseClient, store: Store, email: string | null | undefined, query: string,
): Promise<Json> {
  const p = await personal(db, store, email, "mail");
  if ("offer" in p) return p.offer;

  const path =
    `/me/messages?$search=${encodeURIComponent(`"${query}"`)}&$top=${MAX_ITEMS}` +
    `&$select=subject,from,receivedDateTime,bodyPreview,webLink,hasAttachments`;
  const res = await graph(p.token, path, {}, { ConsistencyLevel: "eventual" });
  if (!res.ok) return { ok: false, note: res.note };

  const messages = ((res.data.value as Json[] | undefined) ?? []).map((m) => ({
    subject: m.subject ?? "(no subject)",
    from: (((m.from as Json | undefined)?.emailAddress as Json | undefined)?.name as string | undefined)
      ?? (((m.from as Json | undefined)?.emailAddress as Json | undefined)?.address as string | undefined) ?? null,
    received: m.receivedDateTime ?? null,
    preview: typeof m.bodyPreview === "string" ? m.bodyPreview.slice(0, 300) : null,
    attachments: m.hasAttachments ?? false,
    link: m.webLink ?? null,
  }));
  if (messages.length === 0) return { ok: true, found: 0, note: "Nothing in your mail matched that." };
  return { ok: true, found: messages.length, messages };
}

/** This person's open tasks, from their default To Do list. */
export async function myTasks(
  db: SupabaseClient, store: Store, email: string | null | undefined,
): Promise<Json> {
  const p = await personal(db, store, email, "tasks");
  if ("offer" in p) return p.offer;

  const listId = await defaultTaskList(p.token);
  if (!listId) return { ok: false, note: "Couldn't find your task list in Microsoft To Do." };

  const res = await graph(
    p.token,
    `/me/todo/lists/${listId}/tasks?$filter=status ne 'completed'&$top=15&$select=title,dueDateTime,importance,createdDateTime`,
  );
  if (!res.ok) return { ok: false, note: res.note };

  const tasks = ((res.data.value as Json[] | undefined) ?? []).map((t) => ({
    title: t.title ?? "(untitled)",
    due: ((t.dueDateTime as Json | undefined)?.dateTime as string | undefined) ?? null,
    importance: t.importance ?? null,
  }));
  return { ok: true, count: tasks.length, tasks };
}

/** Add a task for this person. A write — so it is the kind of call an owner may
 *  set to hold, and it is declared as having a side effect. */
export async function addTask(
  db: SupabaseClient, store: Store, email: string | null | undefined,
  title: string, due?: string,
): Promise<Json> {
  const p = await personal(db, store, email, "tasks");
  if ("offer" in p) return p.offer;
  if (!title.trim()) return { ok: false, note: "A task needs a title." };

  const listId = await defaultTaskList(p.token);
  if (!listId) return { ok: false, note: "Couldn't find your task list in Microsoft To Do." };

  const body: Json = { title: title.trim().slice(0, 250) };
  if (due && /^\d{4}-\d{2}-\d{2}$/.test(due)) {
    body.dueDateTime = { dateTime: `${due}T09:00:00`, timeZone: await storeTimezone(db, store.id) };
  }
  const res = await graph(p.token, `/me/todo/lists/${listId}/tasks`, { method: "POST", body: JSON.stringify(body) });
  if (!res.ok) return { ok: false, note: res.note };
  return { ok: true, added: title.trim(), due: due ?? null };
}

/**
 * Send mail AS this person, from their own mailbox.
 *
 * The most consequential thing this connector can do, and the clearest case for
 * an approval hold: a message sent in someone's name cannot be recalled, and the
 * recipient has no way to tell it came from an assistant.
 */
export async function sendMail(
  db: SupabaseClient, store: Store, email: string | null | undefined,
  to: string, subject: string, bodyText: string,
): Promise<Json> {
  const p = await personal(db, store, email, "mail_send");
  if ("offer" in p) return p.offer;

  const recipients = to.split(/[;,]/).map((a) => a.trim()).filter((a) => a.includes("@"));
  if (recipients.length === 0) return { ok: false, note: "That doesn't look like an email address." };
  if (!subject.trim() || !bodyText.trim()) return { ok: false, note: "A message needs a subject and a body." };

  const res = await graph(p.token, "/me/sendMail", {
    method: "POST",
    body: JSON.stringify({
      message: {
        subject: subject.trim().slice(0, 200),
        body: { contentType: "Text", content: bodyText.slice(0, 8000) },
        toRecipients: recipients.map((address) => ({ emailAddress: { address } })),
      },
      saveToSentItems: true,
    }),
  });
  if (!res.ok) return { ok: false, note: res.note };
  return { ok: true, sent_to: recipients, subject: subject.trim() };
}

/**
 * The assistant's local timezone.
 *
 * Read here rather than taken from the Store row because it lives in the config
 * table, and it genuinely matters: "what's on my calendar today" answered against
 * a UTC day boundary is wrong for anyone west of London for part of every day.
 * Falls back to UTC, which is wrong-but-honest rather than silently local.
 */
async function storeTimezone(db: SupabaseClient, storeId: string): Promise<string> {
  try {
    const { data } = await db.from("agent_config")
      .select("value").eq("store_id", storeId).eq("key", "timezone").maybeSingle();
    const tz = (data as { value?: string } | null)?.value;
    return tz && tz.trim() ? tz.trim() : "UTC";
  } catch {
    return "UTC";
  }
}

/** The person's default To Do list, which is where a task belongs unless they
 *  said otherwise. Cached per call rather than per process: a token is
 *  per-person, so a process-level cache would be a cross-user leak. */
async function defaultTaskList(token: string): Promise<string | null> {
  const res = await graph(token, "/me/todo/lists?$top=20&$select=id,displayName,wellknownListName");
  if (!res.ok) return null;
  const lists = (res.data.value as Json[] | undefined) ?? [];
  const def = lists.find((l) => l.wellknownListName === "defaultList") ?? lists[0];
  return (def?.id as string | undefined) ?? null;
}
