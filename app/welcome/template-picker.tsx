"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, MessageSquare } from "lucide-react";
import { ASSISTANT_TEMPLATES } from "@/lib/assistant-templates";
import { createFromTemplate } from "./actions";
import { Button } from "@/components/ui/button";

/**
 * The first thing anyone setting up an assistant sees.
 *
 * Recognising the job in a list is faster than describing it, and it is what
 * makes an end-to-end setup possible for someone who does not work in software.
 * Picking one creates the assistant immediately, with its brief, its likely
 * systems and its approvals already set, and drops the owner on the checklist.
 *
 * The conversation is still there for anyone whose job is not on the list. It is
 * the second option rather than the only one.
 */
export function TemplatePicker({ onDescribe }: { onDescribe: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();

  function pick(key: string) {
    setBusy(key);
    start(async () => {
      const res = await createFromTemplate(key);
      if (!res.ok) {
        setBusy(null);
        toast.error("Couldn't set that up", { description: res.error });
        return;
      }
      // Full navigation so the new active-assistant cookie and staff link are read.
      window.location.assign("/");
    });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1 text-center">
        <h1 className="font-display text-lg font-bold">What should it handle?</h1>
        <p className="text-muted-foreground text-sm">
          Pick the closest. You can change everything afterwards.
        </p>
      </div>

      <ul className="space-y-2">
        {ASSISTANT_TEMPLATES.map((t) => (
          <li key={t.key}>
            <button
              type="button"
              onClick={() => pick(t.key)}
              disabled={!!busy}
              className="hover:border-teal-deep focus-visible:ring-ring flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors outline-none focus-visible:ring-2 disabled:opacity-60"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{t.name}</span>
                <span className="text-muted-foreground block text-xs">{t.tagline}</span>
              </span>
              {busy === t.key && <Loader2 className="size-4 shrink-0 animate-spin" />}
            </button>
          </li>
        ))}
      </ul>

      <Button variant="ghost" className="w-full" onClick={onDescribe} disabled={!!busy}>
        <MessageSquare className="size-4" /> None of these, let me describe it
      </Button>
    </div>
  );
}
