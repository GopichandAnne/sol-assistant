// What this assistant can actually do, for the person asking.
//
// An assistant that cannot say what it is for competes with "just email
// somebody", and loses. Adoption is not a model problem: a capability nobody
// knows about does not exist, and the first question a new user asks is almost
// always "what can you help me with", answered today by improvising from tool
// names.
//
// Three rules hold this honest, and each exists because the flattering version
// is available and worse:
//
//   • It is assembled from what is REGISTERED right now, never from a written
//     list. A hand-maintained description of the product drifts within a week
//     and then confidently offers things that were turned off in March.
//   • It is personal. Someone who has not connected their own Microsoft account
//     is told what connecting would give them, not told it can already read
//     their mail.
//   • It says what needs approving and what it cannot do. An assistant that
//     mentions only the good half trains people to distrust the whole answer the
//     first time they hit a wall nobody mentioned.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Store } from "./types.ts";
import { listWorkbooks } from "./workbook.ts";
import { enabledBundles, M365_BUNDLES } from "./graph.ts";
import { hasPersonalConnection } from "./connections.ts";

type Json = Record<string, unknown>;

/** Topic titles, not every document: a person wants to know the shape of what it
 *  knows, and forty filenames is a directory listing, not an answer. */
const MAX_TOPICS = 12;

export async function describeCapabilities(
  db: SupabaseClient,
  store: Store,
  opts: {
    email?: string | null;
    connected: string[];
    httpTools: { name: string; description?: string; side_effect?: boolean }[];
    mcpTools: { name: string; description?: string; side_effect?: boolean }[];
    escalationTopics: { key: string; label: string }[];
  },
): Promise<Json> {
  const who = (opts.email ?? "").trim().toLowerCase();

  // What it can answer from.
  let topics: string[] = [];
  let docCount = 0;
  try {
    const { data } = await db
      .from("knowledge_index")
      .select("source_ref")
      .eq("store_id", store.id)
      .eq("kind", "document_chunk");
    const titles = [...new Set(((data ?? []) as { source_ref: string | null }[])
      .map((r) => (r.source_ref ?? "").replace(/\.[a-z0-9]+$/i, "").replace(/[-_]/g, " ").trim())
      .filter(Boolean))];
    docCount = titles.length;
    topics = titles.slice(0, MAX_TOPICS);
  } catch { /* an empty knowledge list is a truthful answer */ }

  // What it can look things up in, and change.
  const books = await listWorkbooks(db, store.id).catch(() => []);
  const canLookUp = books.map((b) => ({ name: b.name, holds: b.purpose }));
  const canChange = books
    .filter((b) => b.writable)
    .map((b) => ({
      name: b.name,
      needs_approval: b.action_policy !== "auto" || b.auto_below == null
        ? true
        : `only above ${b.auto_below}`,
    }));

  // Connected systems, described by what they do rather than by tool name.
  const systems = [...opts.httpTools, ...opts.mcpTools].map((t) => ({
    does: (t.description ?? t.name).split(".")[0].slice(0, 160),
    changes_things: !!t.side_effect,
  }));

  // The person's own Microsoft 365, which is the part that differs per person.
  let yourOwn: string[] = [];
  let couldHave: string[] = [];
  if (opts.connected.includes("microsoft") && who) {
    const mine = await hasPersonalConnection(db, store.id, "microsoft", who).catch(() => false);
    if (mine) {
      const bundles = await enabledBundles(db, store.id, who).catch(() => []);
      yourOwn = bundles
        .filter((b) => b !== "directory")
        .map((b) => M365_BUNDLES[b].why);
    } else {
      couldHave = ["your calendar, your own mail and your tasks, if you connect your Microsoft account"];
    }
  }

  const cannot: string[] = [];
  if (!opts.connected.includes("microsoft")) cannot.push("reach Microsoft 365 here");
  if (books.length === 0) cannot.push("look anything up in a tracker or spreadsheet");
  if (docCount === 0) cannot.push("answer from your documents, because none have been added");

  return {
    ok: true,
    you: who || null,
    answers_about: topics,
    ...(docCount > topics.length ? { and_more_documents: docCount - topics.length } : {}),
    can_look_up: canLookUp,
    can_change: canChange,
    connected_systems: systems,
    your_own_microsoft: yourOwn,
    ...(couldHave.length ? { could_have: couldHave } : {}),
    hands_over_to_people_about: opts.escalationTopics.map((t) => t.label),
    cannot_currently: cannot,
    note:
      "Answer in their words, not this structure. Group it by what THEY would want " +
      "done, name two or three concrete examples they could ask you right now, and " +
      "keep it short. Say plainly which things need someone to approve them, and " +
      "mention anything in cannot_currently only if it is relevant to what they asked. " +
      "Never list raw tool names, and never claim a capability that is not here.",
  };
}
