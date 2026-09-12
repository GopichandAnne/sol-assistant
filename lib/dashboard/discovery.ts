import { inWindow, lastNDays, DASHBOARD_DAYS, type ConvRow } from "./metrics";

/**
 * What to fix next, read off what people actually asked.
 *
 * Every question, and every time the assistant came up short, has been logged
 * since the first conversation. Nothing read it back. So the answer to "what
 * should we automate next" came from workshops and guesswork, while the evidence
 * sat in a table.
 *
 * Three deliberate choices:
 *
 *   • Gaps are grouped by REASON, not lumped together. "We have never written
 *     this down", "it would have to look in another system" and "a person has to
 *     decide" are three different pieces of work — a document, an integration,
 *     and possibly a procedure. A single "couldn't answer" number tells nobody
 *     which one to do.
 *   • Ranked by what it costs to leave alone: how often it comes up, weighted up
 *     when the assistant usually fails it. A thing asked fifty times and answered
 *     every time needs no work.
 *   • Sample sizes travel with every row, and thin evidence is said out loud
 *     rather than rendered as a confident bar chart. Three occurrences is an
 *     anecdote, and presenting it as a finding is how a client stops trusting
 *     the rest of the page.
 */

type A = {
  topic?: string;
  ask?: string;
  resolved?: boolean;
  gap_reason?: string;
  repeatable?: boolean;
  /** Pre-rewrite rows classified by the retail prompt. Used only to tell "this
   *  conversation predates the current questions" from "it had no gap". */
  missing_items?: unknown;
};

function parse(json: string | null): A {
  if (!json) return {};
  try {
    return JSON.parse(json) as A;
  } catch {
    return {};
  }
}

/** Below this, a row is evidence of nothing in particular. */
const MIN_OCCURRENCES = 3;

export type AskGroup = {
  ask: string;
  topic: string;
  /** Times it came up. */
  count: number;
  /** Times the assistant did NOT resolve it. */
  unresolved: number;
  /** Whether the model judged this routine, recurring work. */
  repeatable: boolean;
};

export type GapReason = "no_source" | "needs_system" | "needs_person" | "unclear" | "out_of_scope";

export const GAP_LABEL: Record<GapReason, string> = {
  no_source: "Nothing to answer from",
  needs_system: "Needs a system it can't reach",
  needs_person: "Needs a person to decide",
  unclear: "The question wasn't clear",
  out_of_scope: "Not what it's for",
};

/** What the operator should actually do about each kind of gap. */
export const GAP_ACTION: Record<GapReason, string> = {
  no_source: "Add it to Knowledge — these are answers nobody has written down yet.",
  needs_system: "Connect the system under Tools & systems, so it can look this up itself.",
  needs_person: "These need judgement. The repeatable ones are the candidates for a procedure.",
  unclear: "Usually wording, not knowledge — worth reading a few in full before changing anything.",
  out_of_scope: "Fine to leave. Worth checking people aren't being pointed here by mistake.",
};

export type Discovery = {
  windowDays: number;
  /** Conversations carrying the current classification. Everything below is out of this. */
  classified: number;
  /** Rows still classified by the old retail prompt — excluded, and said so. */
  legacy: number;
  /** Ranked by cost of leaving alone: volume, weighted by how often it fails. */
  topAsks: AskGroup[];
  /** Gap counts by reason, largest first. */
  gapsByReason: { reason: GapReason; count: number }[];
  /** Repeatable, and it keeps needing a person or a system it hasn't got. */
  automatable: AskGroup[];
  /** Topic with the most unresolved asks, when one clearly stands out. */
  worstTopic: { topic: string; unresolved: number } | null;
  /** True when there simply isn't enough yet to draw anything from. */
  thin: boolean;
};

export function computeDiscovery(convs: ConvRow[]): Discovery {
  const days = lastNDays(DASHBOARD_DAYS);
  const rows = inWindow(convs, days);

  const groups = new Map<string, AskGroup>();
  const gaps = new Map<GapReason, number>();
  const topicMiss = new Map<string, number>();
  let classified = 0;
  let legacy = 0;

  for (const row of rows) {
    const a = parse(row.analytics_json);
    // `resolved` is the marker of the current prompt. Without it we cannot say
    // whether the assistant succeeded, and guessing from the retail fields would
    // put invented numbers on a page whose whole job is to be trusted.
    if (typeof a.resolved !== "boolean") {
      if (a.missing_items !== undefined) legacy++;
      continue;
    }
    classified++;

    const ask = (a.ask ?? "").trim().toLowerCase();
    const topic = (a.topic ?? "Other").trim() || "Other";
    const failed = a.resolved === false;

    if (failed) {
      const reason = (a.gap_reason ?? "") as GapReason;
      if (reason && reason !== ("none" as unknown as GapReason) && reason in GAP_LABEL) {
        gaps.set(reason, (gaps.get(reason) ?? 0) + 1);
      }
      topicMiss.set(topic, (topicMiss.get(topic) ?? 0) + 1);
    }

    // Greetings and small talk classify with an empty ask; they are conversations,
    // not demand, and counting them would put "hello" at the top of the list.
    if (!ask) continue;
    const g = groups.get(ask);
    if (g) {
      g.count++;
      if (failed) g.unresolved++;
      g.repeatable = g.repeatable || !!a.repeatable;
    } else {
      groups.set(ask, {
        ask,
        topic,
        count: 1,
        unresolved: failed ? 1 : 0,
        repeatable: !!a.repeatable,
      });
    }
  }

  const solid = [...groups.values()].filter((g) => g.count >= MIN_OCCURRENCES);

  // Cost of leaving it alone. A thing asked often and answered every time scores
  // its volume; one that fails every time scores double. Nothing here is a
  // probability, so it is used for ordering only and never shown as a number.
  const cost = (g: AskGroup) => g.count * (1 + g.unresolved / g.count);

  const topAsks = [...solid].sort((a, b) => cost(b) - cost(a)).slice(0, 8);

  const automatable = solid
    .filter((g) => g.repeatable && g.unresolved > 0)
    .sort((a, b) => b.unresolved - a.unresolved)
    .slice(0, 6);

  const gapsByReason = [...gaps.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);

  const ranked = [...topicMiss.entries()].sort((a, b) => b[1] - a[1]);
  // Only call out a worst topic when it is actually worse — a near-tie named as
  // a finding sends someone to fix the wrong department.
  const worstTopic =
    ranked.length > 0 && ranked[0][1] >= 3 && (ranked.length === 1 || ranked[0][1] >= ranked[1][1] * 1.5)
      ? { topic: ranked[0][0], unresolved: ranked[0][1] }
      : null;

  return {
    windowDays: DASHBOARD_DAYS,
    classified,
    legacy,
    topAsks,
    gapsByReason,
    automatable,
    worstTopic,
    thin: classified < 20 || solid.length === 0,
  };
}
