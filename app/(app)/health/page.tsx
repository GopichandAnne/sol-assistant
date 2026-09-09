import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getActiveStore } from "@/lib/store/active-store";
import { createClient } from "@/lib/supabase/server";
import { computeSaasHealth } from "@/lib/dashboard/saas-health";
import type { ConvRow } from "@/lib/dashboard/metrics";
import { SaasHealthView } from "@/components/dashboard/saas-health";
import { AnswerFeedback } from "@/components/dashboard/answer-feedback";
import { listOpenFeedback } from "./feedback-actions";
import { SetupChecklist } from "@/components/setup/setup-checklist";

export const metadata: Metadata = { title: "Assistant health · The Assistant" };

/** The SaaS/product console home — how the embedded assistant is doing. */
export default async function HealthPage() {
  const ctx = await getActiveStore();
  if (!ctx || !ctx.active) redirect("/login");
  const store = ctx.active;

  const supabase = await createClient();
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [convsRes, leadsRes] = await Promise.all([
    supabase
      .from("conversations")
      .select("timestamp, device_type, analytics_json, response_time_ms, created_at")
      .eq("store_slug", store.slug)
      .order("created_at", { ascending: false })
      .limit(8000),
    supabase
      .from("requests")
      .select("id", { count: "exact", head: true })
      .eq("store_id", store.id)
      .gte("created_at", since),
  ]);

  const health = computeSaasHealth((convsRes.data ?? []) as ConvRow[], leadsRes.count ?? 0);
  // Answers colleagues said were wrong. Above the metrics on purpose: a known bad
  // answer is more urgent than a self-serve rate, and it is the thing an owner can
  // actually act on today. Owner-only, and renders nothing when the queue is empty.
  const feedback = await listOpenFeedback().catch(() => []);
  return (
    <>
      <SetupChecklist />
      <div className="mx-auto max-w-4xl px-6 pt-6">
        <AnswerFeedback initial={feedback} />
      </div>
      <SaasHealthView health={health} storeName={store.name} />
    </>
  );
}
