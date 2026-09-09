"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, Loader2, MessageSquareWarning } from "lucide-react";
import { markReviewed, type Feedback } from "@/app/(app)/health/feedback-actions";
import { Button } from "@/components/ui/button";

/**
 * Answers your colleagues said were wrong.
 *
 * Shows the exchange, not just a count: a report saying "someone was unhappy" is
 * not actionable, and the question plus the answer is what a person needs to fix
 * the knowledge behind it. Renders nothing when the queue is empty, so a healthy
 * assistant shows a clean page rather than an empty widget.
 */
export function AnswerFeedback({ initial }: { initial: Feedback[] }) {
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();

  if (rows.length === 0) return null;

  function review(id: string) {
    setBusy(id);
    start(async () => {
      const res = await markReviewed(id);
      setBusy(null);
      if (res.ok) setRows((r) => r.filter((x) => x.id !== id));
      else toast.error("Couldn't update", { description: res.error });
    });
  }

  return (
    <section className="rounded-xl border border-amber-300 bg-amber-50 p-5 dark:border-amber-900/60 dark:bg-amber-950/30">
      <div className="flex items-center gap-2">
        <MessageSquareWarning className="size-4 text-amber-600 dark:text-amber-500" />
        <h2 className="font-display font-bold">
          {rows.length} answer{rows.length === 1 ? "" : "s"} someone said {rows.length === 1 ? "was" : "were"} wrong
        </h2>
      </div>
      <p className="text-muted-foreground mt-1 mb-3 text-sm">
        Reported by the people reading them. Fix the source, then clear it.
      </p>
      <ul className="space-y-3">
        {rows.map((f) => (
          <li key={f.id} className="bg-card rounded-lg border p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1.5 text-sm">
                <p><span className="text-muted-foreground">Asked:</span> {f.question || "—"}</p>
                <p><span className="text-muted-foreground">It said:</span> {f.answer || "—"}</p>
                {f.note && <p className="text-amber-800 dark:text-amber-300"><span className="text-muted-foreground">They said:</span> {f.note}</p>}
                <p className="text-muted-foreground text-xs">
                  {f.reportedBy ?? "Someone"}{f.channel ? ` in ${f.channel}` : ""} ·{" "}
                  {new Date(f.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </p>
              </div>
              <Button size="sm" variant="outline" disabled={busy === f.id} onClick={() => review(f.id)}>
                {busy === f.id ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                Done
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
