"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Coins, TriangleAlert, Bot, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  setThreshold,
  setBillingEmail,
  type CompanyView,
  type CreditsView,
  type LedgerRow,
  type AssistantSpend,
} from "@/app/(app)/billing/actions";

/**
 * Credits for the account. One pool shared by every assistant the account owns.
 *
 * There is no checkout here on purpose — credits are granted, not bought in-product.
 * What the owner controls is the level at which they want warning, and who hears it.
 */
export function BillingView({
  company,
  credits,
  ledger,
  spend,
}: {
  company: CompanyView | null;
  credits: CreditsView | null;
  ledger: LedgerRow[];
  spend: AssistantSpend[];
}) {
  if (!company || !credits) return <Unassigned />;

  const low = credits.remaining <= credits.threshold;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <header>
        <h1 className="font-display text-2xl">Credits</h1>
        <p className="text-muted-foreground text-sm">
          {company.name} — one balance across every assistant on this account.
        </p>
      </header>

      <div className="bg-card rounded-xl border p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-muted-foreground flex items-center gap-2 text-xs font-medium">
              <Coins className="size-4" /> Remaining
            </div>
            <div className="font-display mt-1 text-4xl font-extrabold tabular-nums">
              {credits.remaining.toLocaleString()}
            </div>
          </div>
          <dl className="text-muted-foreground flex gap-6 text-sm">
            <div>
              <dt className="text-xs">Granted</dt>
              <dd className="text-foreground tabular-nums">{credits.granted.toLocaleString()}</dd>
            </div>
            <div>
              <dt className="text-xs">Used</dt>
              <dd className="text-foreground tabular-nums">{credits.spent.toLocaleString()}</dd>
            </div>
          </dl>
        </div>

        {low ? (
          <div className="mt-4 flex gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900/60 dark:bg-amber-950/40">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-500" />
            <p className="text-amber-900 dark:text-amber-200">
              You&apos;re at or below your warning level of {credits.threshold.toLocaleString()} credits.
              Your assistants are still running and will keep answering — nothing has been switched off.
              Ask us to top up when you&apos;re ready.
            </p>
          </div>
        ) : (
          <p className="text-muted-foreground mt-4 text-sm">
            We&apos;ll email you when this drops to {credits.threshold.toLocaleString()}.
          </p>
        )}
      </div>

      <Settings company={company} credits={credits} />

      {spend.length > 0 && (
        <section className="bg-card rounded-xl border p-5">
          <h2 className="font-display font-bold">Where credits went</h2>
          <p className="text-muted-foreground mb-3 text-xs">Last 30 days, by assistant</p>
          <ul className="space-y-2">
            {spend.map((s) => {
              const top = spend[0].credits || 1;
              return (
                <li key={s.assistant} className="flex items-center gap-3 text-sm">
                  <Bot className="text-muted-foreground size-3.5 shrink-0" />
                  <span className="w-40 shrink-0 truncate">{s.assistant}</span>
                  <span className="bg-muted h-2 flex-1 overflow-hidden rounded-full">
                    <span
                      className="block h-full rounded-full"
                      style={{ width: `${Math.max(2, (s.credits / top) * 100)}%`, background: "var(--sol-orange-dark)" }}
                    />
                  </span>
                  <span className="text-muted-foreground w-16 shrink-0 text-right tabular-nums">
                    {s.credits.toLocaleString()}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="bg-card rounded-xl border p-5">
        <h2 className="font-display font-bold">Activity</h2>
        {ledger.length === 0 ? (
          <p className="text-muted-foreground mt-3 text-sm">Nothing yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground text-left text-xs">
                  <th className="pb-2 font-medium">When</th>
                  <th className="pb-2 font-medium">What</th>
                  <th className="pb-2 font-medium">Assistant</th>
                  <th className="pb-2 text-right font-medium">Credits</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((r, i) => (
                  <tr key={i} className="border-t">
                    <td className="text-muted-foreground py-2 whitespace-nowrap">
                      {new Date(r.ts).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </td>
                    <td className="py-2">{r.reason}</td>
                    <td className="text-muted-foreground py-2">{r.assistant ?? "—"}</td>
                    <td
                      className={`py-2 text-right tabular-nums ${r.delta > 0 ? "text-teal-deep font-medium" : ""}`}
                    >
                      {r.delta > 0 ? `+${r.delta.toLocaleString()}` : r.delta.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Settings({ company, credits }: { company: CompanyView; credits: CreditsView }) {
  const router = useRouter();
  const [threshold, setThresholdValue] = useState(String(credits.threshold));
  const [email, setEmail] = useState(company.billingEmail ?? "");
  const [pending, start] = useTransition();

  function saveThreshold() {
    const n = parseInt(threshold, 10);
    start(async () => {
      const res = await setThreshold(company.id, n);
      if (res.ok) {
        toast.success(`We'll warn you at ${n.toLocaleString()} credits`);
        router.refresh();
      } else toast.error("Couldn't save", { description: res.error });
    });
  }

  function saveEmail() {
    start(async () => {
      const res = await setBillingEmail(company.id, email);
      if (res.ok) {
        toast.success(email.trim() ? `Warnings will go to ${email.trim()}` : "Warnings will go to account owners");
        router.refresh();
      } else toast.error("Couldn't save", { description: res.error });
    });
  }

  return (
    <section className="bg-card rounded-xl border p-5">
      <h2 className="font-display font-bold">Warn me early</h2>
      <p className="text-muted-foreground mb-4 text-sm">
        A warning is a heads-up, not a cut-off — your assistants keep answering either way.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="threshold" className="mb-1.5 block text-sm font-medium">
            Warn me below
          </label>
          <div className="flex gap-2">
            <Input
              id="threshold"
              type="number"
              min={0}
              value={threshold}
              onChange={(e) => setThresholdValue(e.target.value)}
              className="max-w-32"
            />
            <Button variant="outline" size="sm" disabled={pending} onClick={saveThreshold}>
              <Check className="size-4" /> Save
            </Button>
          </div>
          <p className="text-muted-foreground mt-1.5 text-xs">credits remaining</p>
        </div>
        <div>
          <label htmlFor="billing-email" className="mb-1.5 block text-sm font-medium">
            Send warnings to
          </label>
          <div className="flex gap-2">
            <Input
              id="billing-email"
              type="email"
              placeholder="Account owners"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Button variant="outline" size="sm" disabled={pending} onClick={saveEmail}>
              <Check className="size-4" /> Save
            </Button>
          </div>
          <p className="text-muted-foreground mt-1.5 text-xs">
            Leave blank to email everyone who owns this account.
          </p>
        </div>
      </div>
    </section>
  );
}

function Unassigned() {
  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="font-display text-2xl">Credits</h1>
      <div className="bg-card mt-4 rounded-xl border p-8 text-center">
        <Coins className="mx-auto size-8" style={{ color: "var(--sol-orange-dark)" }} />
        <h2 className="font-display mt-3 text-xl font-bold">This assistant isn&apos;t on an account yet</h2>
        <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
          Its usage is being recorded, but there&apos;s no credit balance to show until it&apos;s attached
          to an account. Get in touch and we&apos;ll set that up.
        </p>
      </div>
    </div>
  );
}
