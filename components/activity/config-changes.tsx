import { History, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ConfigAuditEntry } from "@/app/(app)/requests/actions";

/**
 * Changes an owner made to the assistant's own configuration.
 *
 * This used to sit at the bottom of the Requests tab in the Inbox, which put it
 * two steps from where anyone would look for it: a config change is not a request,
 * and the Inbox is for things still needing a person. It belongs beside the tool
 * calls on "What it did" — both answer the same question, which is what happened
 * here and who did it.
 */
export function ConfigChanges({ audit }: { audit: ConfigAuditEntry[] }) {
  if (audit.length === 0) return null;
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <History className="text-muted-foreground size-4" />
        <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
          Changes to its setup
        </span>
      </div>
      <ul className="space-y-2">
        {audit.map((a) => (
          <li key={a.id} className="bg-card rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-2">
              {a.source === "nl" && (
                <Badge variant="outline" className="gap-1 text-xs">
                  <Sparkles className="size-3" /> sentence
                </Badge>
              )}
              <p className="text-sm">{a.summary}</p>
            </div>
            {a.details?.instruction && (
              <p className="text-muted-foreground mt-1 text-xs italic">
                &ldquo;{a.details.instruction}&rdquo;
              </p>
            )}
            <p className="text-muted-foreground mt-1 text-xs">
              {[a.actor, fmtDate(a.created_at)].filter(Boolean).join(" · ")}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
