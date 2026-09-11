"use client";

import { BookOpen, MessageSquare, UserCheck, Wrench } from "lucide-react";
import type { AssistantRow } from "./actions";

/**
 * How far along each of a client's assistants actually is.
 *
 * A super-admin running several clients needs to see who is stuck and on what
 * without switching into each account and reading its checklist. These five are
 * the ones that decide whether an assistant is doing anything real rather than
 * merely existing: something to answer from, somebody to escalate to, a system to
 * act in, somewhere people can reach it, and whether anyone has.
 *
 * Deliberately not a score. A number would invite chasing the number; what a
 * person setting up a client needs is to see the empty one and go fix it.
 */
export function AssistantReadiness({ assistants }: { assistants: AssistantRow[] }) {
  if (assistants.length === 0) {
    return <p className="text-muted-foreground mt-3 text-xs">No assistants yet.</p>;
  }

  return (
    <ul className="mt-3 space-y-2">
      {assistants.map((a) => {
        const reach = [
          a.channels.teams && "Teams",
          a.channels.slack && "Slack",
          a.channels.web && "web",
        ].filter(Boolean) as string[];

        return (
          <li key={a.id} className="rounded-lg border px-3 py-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <span className="text-sm font-medium">{a.name}</span>
              <span className="text-muted-foreground font-mono text-[11px]">{a.slug}</span>
            </div>

            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              <Stat icon={BookOpen} label="knowledge" value={a.knowledge} />
              <Stat icon={UserCheck} label="responders" value={a.responders} />
              <Stat icon={Wrench} label="systems" value={a.tools} />
              <Stat icon={MessageSquare} label="conversations" value={a.conversations} />
              <span className={reach.length ? "text-muted-foreground" : "text-amber-700 dark:text-amber-500"}>
                {reach.length ? `reachable in ${reach.join(", ")}` : "nowhere to reach it yet"}
              </span>
            </div>

            {/* The one that matters most, called out rather than left as a zero:
                with nobody to escalate to, everything it cannot answer waits in a
                console nobody is watching. */}
            {a.responders === 0 && (
              <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-500">
                Nobody is set to pick up what it can&apos;t answer.
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
}) {
  const empty = value === 0;
  return (
    <span className={empty ? "text-amber-700 dark:text-amber-500" : "text-muted-foreground"}>
      <Icon className="mr-1 inline size-3" />
      <span className="tabular-nums">{value}</span> {label}
    </span>
  );
}
