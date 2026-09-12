import Link from "next/link";
import { CalendarClock, CircleAlert, CircleCheck, PauseCircle } from "lucide-react";
import type { Run } from "@/app/(app)/scheduled/actions";

/**
 * What the scheduled work actually did.
 *
 * Individual tool calls and approvals were already logged, but there was no
 * answer to "what has this thing been doing", which is the first question an
 * owner asks and the first slide of any review. Three statuses rather than two,
 * because "it ran and something is waiting for a person" is neither success nor
 * failure and reads as a lie if forced into either.
 *
 * The assistant's own words are shown, not a summary of them. A run that claims
 * to have done something it did not is worth seeing verbatim.
 */
const LOOK: Record<Run["status"], { icon: typeof CircleCheck; label: string; className: string }> = {
  ok: { icon: CircleCheck, label: "Finished", className: "text-teal-deep dark:text-teal-light" },
  held: { icon: PauseCircle, label: "Waiting for approval", className: "text-amber-700 dark:text-amber-500" },
  error: { icon: CircleAlert, label: "Didn't finish", className: "text-destructive" },
};

function fmt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function Runs({ runs }: { runs: Run[] }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CalendarClock className="text-muted-foreground size-4" />
          <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
            Scheduled runs
          </span>
        </div>
        <Link
          href="/scheduled"
          className="shrink-0 text-xs font-medium hover:underline"
          style={{ color: "var(--sol-orange-dark)" }}
        >
          Scheduled work &rarr;
        </Link>
      </div>

      {runs.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
          Nothing has run yet. Anything you schedule shows up here with what it did and who it
          acted as.
        </p>
      ) : (
        <ul className="space-y-2">
          {runs.map((r) => {
            const look = LOOK[r.status];
            const Icon = look.icon;
            return (
              <li key={r.id} className="bg-card rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <Icon className={`size-4 shrink-0 ${look.className}`} />
                    <span className="truncate text-sm font-medium">{r.triggerName}</span>
                  </span>
                  <span className="text-muted-foreground shrink-0 text-xs">{fmt(r.startedAt)}</span>
                </div>

                {r.detail && (
                  <p className="text-muted-foreground mt-2 whitespace-pre-wrap text-sm">{r.detail}</p>
                )}

                <p className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <span className={look.className}>{look.label}</span>
                  {r.runsAs && <span>as {r.runsAs}</span>}
                  {r.toolsUsed > 0 && (
                    <span>
                      {r.toolsUsed} tool call{r.toolsUsed === 1 ? "" : "s"}
                    </span>
                  )}
                  {r.actionsHeld > 0 && (
                    <span>
                      {r.actionsHeld} waiting for approval
                    </span>
                  )}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
