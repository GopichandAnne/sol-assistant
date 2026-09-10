"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, Loader2, Lock } from "lucide-react";
import { m365ConsentUrl, type M365Capability } from "./actions";
import { Button } from "@/components/ui/button";

/**
 * What the Microsoft 365 connection is allowed to do, and how to allow more.
 *
 * Connecting asks only for the permissions a person can approve for themselves,
 * so the connection starts narrow on purpose. Everything else is approved one
 * capability at a time — here by an administrator, or from a chat by whoever
 * needs it, at the moment they need it.
 *
 * Showing them as a list rather than a single "connected" tick is the point: an
 * organisation should be able to see that the assistant can find a document and
 * cannot read anyone's mail, and change exactly one of those things.
 */
export function M365Capabilities({
  capabilities,
  isOwner,
}: {
  capabilities: M365Capability[];
  isOwner: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();

  if (capabilities.length === 0) return null;

  function approve(key: string) {
    setBusy(key);
    start(async () => {
      const res = await m365ConsentUrl(key);
      if (!res.ok) {
        setBusy(null);
        toast.error("Couldn't start the approval", { description: res.error });
        return;
      }
      // Straight to Microsoft's own consent screen — we never see the approval,
      // only its result.
      window.location.href = res.url;
    });
  }

  return (
    <div className="mt-3 space-y-1 border-t pt-3">
      <p className="text-muted-foreground mb-2 text-xs">
        What it&apos;s allowed to do. Each is approved separately, so you grant what you want and
        nothing else.
      </p>
      <ul className="space-y-1">
        {capabilities.map((c) => (
          <li key={c.key} className="flex items-start gap-3 py-1">
            <span className="mt-0.5 shrink-0">
              {c.enabled ? (
                <Check className="size-4 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <Lock className="text-muted-foreground size-4" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{c.label}</span>
              <span className="text-muted-foreground block text-xs">{c.why}</span>
            </span>
            {!c.enabled && c.optional && (
              <Button
                size="sm"
                variant="outline"
                disabled={!!busy || !isOwner}
                onClick={() => approve(c.key)}
              >
                {busy === c.key ? <Loader2 className="size-4 animate-spin" /> : "Approve"}
              </Button>
            )}
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground pt-1 text-[11px]">
        Approving sends you to Microsoft to sign in. If your organisation requires an administrator
        to approve apps, Microsoft will say so on that screen — the same link works for them.
      </p>
    </div>
  );
}
