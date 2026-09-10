import {
  DASHBOARD_DAYS,
  lastNDays,
  inWindow,
  countPerDay,
  languageCounts,
  sentimentCounts,
  topRequested,
  topMissing,
  gapConversationCount,
  type ConvRow,
} from "@/lib/dashboard/metrics";

/** A captured lead / request row (the `requests` table). `type` is the capture
 *  kind the owner enabled — demo, quote, support, careers, etc. */
export type LeadRow = { type: string | null; created_at: string; status: string | null };

/**
 * The SaaS/product dashboard: how the embedded assistant is performing as a
 * front line — conversations handled, requests captured, how often it answers
 * without needing a person, and how fast — over the last DASHBOARD_DAYS. Reuses
 * the shared conversation helpers so this stays in lock-step with the rest of the
 * analytics.
 */
export function computeSaasDashboard(convs: ConvRow[], leads: LeadRow[]) {
  const days = lastNDays(DASHBOARD_DAYS);
  const c = inWindow(convs, days);
  const leadRows = leads.map((l) => ({ timestamp: null, created_at: l.created_at, type: l.type }));
  const l = inWindow(leadRows, days);

  const responseTimes = c
    .map((x) => x.response_time_ms)
    .filter((n): n is number => typeof n === "number" && n > 0);
  const avgResponseMs =
    responseTimes.length > 0
      ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
      : null;

  const total = c.length;
  const gaps = gapConversationCount(c);
  const selfServePct = total > 0 ? Math.round(((total - gaps) / total) * 100) : null;

  const typeMap = new Map<string, number>();
  for (const r of l) {
    const k = (r.type || "other").trim().toLowerCase() || "other";
    typeMap.set(k, (typeMap.get(k) ?? 0) + 1);
  }
  const leadsByType = [...typeMap.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);

  return {
    days,
    totalConversations: total,
    totalLeads: l.length,
    selfServePct,
    avgResponseMs,
    convsPerDay: countPerDay(c, days),
    leadsPerDay: countPerDay(l, days),
    leadsByType,
    languages: languageCounts(c),
    sentiment: sentimentCounts(c),
    topicsAsked: topRequested(c),
    gaps: topMissing(c),
  };
}

export type SaasDashboardMetrics = ReturnType<typeof computeSaasDashboard>;

/**
 * Friendly names for request types we already know about. Everything else falls
 * back to the type's own name, because the types are whatever the organisation
 * defined — an access request, a leave request, an expense query. The old list
 * named only an outbound sales funnel, which quietly implied that was the
 * universe of things an assistant collects.
 */
const LEAD_TYPE_LABEL: Record<string, string> = {
  demo: "Demo requests",
  quote: "Quote / pricing",
  sales: "Sales enquiries",
  support: "Support questions",
  careers: "Job applicants",
  contact: "Contact requests",
  other: "Other",
};

export function leadTypeLabel(type: string): string {
  return LEAD_TYPE_LABEL[type] ?? type.charAt(0).toUpperCase() + type.slice(1);
}
