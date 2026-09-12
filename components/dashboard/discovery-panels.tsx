import Link from "next/link";
import { ArrowUpRight, HelpCircle, Repeat } from "lucide-react";
import { GAP_ACTION, GAP_LABEL, type Discovery } from "@/lib/dashboard/discovery";

/**
 * What to fix next — the same evidence the assistant has been collecting all
 * along, read back as work.
 *
 * Replaces two panels that showed product names and out-of-stock items, which is
 * what the retail classifier extracted. Three rules held to here:
 *
 *   • Every gap is shown with what to DO about it. "Nothing to answer from" is a
 *     document to write; "needs a system it can't reach" is an integration. A
 *     list of problems with no next step is a list an operator learns to skip.
 *   • Thin evidence says so. Under twenty classified conversations the panels
 *     step aside rather than rank three data points into a finding.
 *   • Conversations recorded before the classifier changed are counted and
 *     excluded, never silently folded in — the earlier prompt was asking a
 *     different question, so its answers cannot be compared with these.
 */
export function DiscoveryPanels({ d }: { d: Discovery }) {
  if (d.thin) {
    return (
      <div className="bg-card rounded-xl border border-dashed p-5">
        <h3 className="font-display font-bold">What to fix next</h3>
        <p className="text-muted-foreground mt-2 text-sm">
          {d.classified === 0
            ? "Nothing classified yet. Once people have used the assistant for a few days, this is where what they kept asking — and what it couldn't answer — shows up as work to do."
            : `Only ${d.classified} conversation${d.classified === 1 ? "" : "s"} so far. Not enough to tell a pattern from a coincidence, so nothing is ranked here yet.`}
        </p>
        {d.legacy > 0 && <LegacyNote n={d.legacy} />}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="bg-card rounded-xl border p-5">
          <h3 className="font-display font-bold">What people keep asking</h3>
          <p className="text-muted-foreground mt-1 text-xs">
            Grouped by what they wanted, over {d.windowDays} days.
          </p>
          <ul className="mt-3 space-y-1.5">
            {d.topAsks.map((a) => (
              <li key={a.ask} className="flex items-start justify-between gap-3 text-sm">
                <span className="min-w-0">
                  <span className="break-words">{a.ask}</span>
                  <span className="text-muted-foreground ml-2 text-xs">{a.topic}</span>
                </span>
                <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                  {a.count}×
                  {a.unresolved > 0 && (
                    <span style={{ color: "var(--sol-orange-dark)" }}> · {a.unresolved} missed</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="bg-card rounded-xl border p-5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-display font-bold">Where it fell short</h3>
            <Link
              href="/knowledge"
              className="shrink-0 text-xs font-medium hover:underline"
              style={{ color: "var(--sol-orange-dark)" }}
            >
              Knowledge →
            </Link>
          </div>
          {d.gapsByReason.length === 0 ? (
            <p className="text-muted-foreground mt-3 text-sm">
              It answered everything it was asked in this period.
            </p>
          ) : (
            <ul className="mt-3 space-y-3">
              {d.gapsByReason.map((g) => (
                <li key={g.reason}>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <HelpCircle className="text-muted-foreground size-3.5 shrink-0" />
                      <span className="truncate">{GAP_LABEL[g.reason]}</span>
                    </span>
                    <span className="text-muted-foreground shrink-0 text-xs tabular-nums">{g.count}×</span>
                  </div>
                  <p className="text-muted-foreground mt-0.5 pl-5.5 text-xs">{GAP_ACTION[g.reason]}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {d.automatable.length > 0 && (
        <div className="bg-card rounded-xl border p-5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-display flex items-center gap-2 font-bold">
              <Repeat className="size-4" style={{ color: "var(--sol-orange-dark)" }} />
              Worth automating
            </h3>
            <Link
              href="/connections"
              className="shrink-0 text-xs font-medium hover:underline"
              style={{ color: "var(--sol-orange-dark)" }}
            >
              Tools &amp; systems →
            </Link>
          </div>
          <p className="text-muted-foreground mt-1 text-xs">
            Routine work that keeps needing a person, or a system the assistant can&apos;t reach yet.
          </p>
          <ul className="mt-3 space-y-1.5">
            {d.automatable.map((a) => (
              <li key={a.ask} className="flex items-start justify-between gap-3 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <ArrowUpRight className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
                  <span className="break-words">{a.ask}</span>
                </span>
                <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                  {a.unresolved} of {a.count} missed
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {d.worstTopic && (
        <p className="text-muted-foreground text-xs">
          Most of what it misses is <strong className="text-foreground">{d.worstTopic.topic}</strong> —{" "}
          {d.worstTopic.unresolved} unanswered in {d.windowDays} days.
        </p>
      )}

      {d.legacy > 0 && <LegacyNote n={d.legacy} />}
    </div>
  );
}

function LegacyNote({ n }: { n: number }) {
  return (
    <p className="text-muted-foreground mt-3 text-xs">
      {n} earlier conversation{n === 1 ? " is" : "s are"} not counted here — {n === 1 ? "it was" : "they were"}{" "}
      classified before this page started asking what people wanted and whether they got it.
    </p>
  );
}
