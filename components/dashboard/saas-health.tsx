import Link from "next/link";
import { DiscoveryPanels } from "@/components/dashboard/discovery-panels";
import { MessagesSquare, Gauge, UserPlus, Clock, BookOpen, Code2, Sparkles, type LucideIcon } from "lucide-react";
import type { SaasHealth } from "@/lib/dashboard/saas-health";

function fmtMs(ms: number | null): string {
  if (ms == null) return "—";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function Kpi({ icon: Icon, label, value, hint }: { icon: LucideIcon; label: string; value: string; hint?: string }) {
  return (
    <div className="bg-card rounded-xl border p-4">
      <div className="text-muted-foreground flex items-center gap-2 text-xs font-medium">
        <Icon className="size-4" /> {label}
      </div>
      <div className="font-display mt-2 text-3xl font-extrabold">{value}</div>
      {hint && <div className="text-muted-foreground mt-1 text-xs">{hint}</div>}
    </div>
  );
}

export function SaasHealthView({ health, storeName }: { health: SaasHealth; storeName: string }) {
  const h = health;
  const empty = h.totalConversations === 0;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header>
        <h1 className="font-display text-2xl">Assistant health</h1>
        <p className="text-muted-foreground text-sm">
          {storeName} — last {h.windowDays} days
        </p>
      </header>

      {empty ? (
        <div className="bg-card rounded-xl border p-8 text-center">
          <Sparkles className="mx-auto size-8" style={{ color: "var(--sol-orange-dark)" }} />
          <h2 className="font-display mt-3 text-xl font-bold">The assistant&apos;s ready to work</h2>
          <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
            No conversations yet. Connect your docs so the assistant can answer from them, then embed it on your site.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <Link href="/knowledge" className="hover:bg-muted inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium">
              <BookOpen className="size-4" /> Connect your docs
            </Link>
            <Link href="/link" className="bg-gradient-primary text-primary-foreground shadow-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium">
              <Code2 className="size-4" /> Embed &amp; install
            </Link>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi icon={MessagesSquare} label="Conversations" value={String(h.totalConversations)} />
            <Kpi icon={Gauge} label="Answered on its own" value={h.selfServeRate == null ? "—" : `${h.selfServeRate}%`} hint="no person needed" />
            <Kpi icon={UserPlus} label="Requests captured" value={String(h.leadsCaptured)} />
            <Kpi icon={Clock} label="Avg response" value={fmtMs(h.avgResponseMs)} />
          </div>

          <DiscoveryPanels d={h.discovery} />

          <div className="bg-card rounded-xl border p-5">
            <h3 className="font-display font-bold">How conversations felt</h3>
            <SentimentBar s={h.sentiment} />
          </div>
        </>
      )}
    </div>
  );
}

function SentimentBar({ s }: { s: { positive: number; neutral: number; negative: number } }) {
  const total = s.positive + s.neutral + s.negative;
  if (total === 0) return <p className="text-muted-foreground mt-3 text-sm">Not enough sentiment data yet.</p>;
  const pct = (n: number) => `${Math.round((n / total) * 100)}%`;
  return (
    <div className="mt-3">
      <div className="flex h-3 overflow-hidden rounded-full">
        <div style={{ width: pct(s.positive), background: "var(--sol-orange)" }} />
        <div style={{ width: pct(s.neutral), background: "#cbd5e1" }} />
        <div style={{ width: pct(s.negative), background: "var(--sol-teal)" }} />
      </div>
      <div className="text-muted-foreground mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <span>{pct(s.positive)} positive</span>
        <span>{pct(s.neutral)} neutral</span>
        <span>{pct(s.negative)} negative</span>
      </div>
    </div>
  );
}
