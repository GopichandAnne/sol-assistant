import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getActiveStore } from "@/lib/store/active-store";
import { createClient } from "@/lib/supabase/server";
import { AgentView } from "@/components/agent/agent-view";
import {  listResponders } from "./actions";
import { listRequestTypes } from "@/app/(app)/requests/actions";

export const metadata: Metadata = { title: "Agent · The Assistant" };

export default async function AgentPage() {
  const ctx = await getActiveStore();
  if (!ctx || !ctx.active) redirect("/login");
  const store = ctx.active;

  const supabase = await createClient();
  // Owner-only screen (nav is owner-gated too; enforce here as well).
  const { data: isOwner } = await supabase.rpc("user_is_owner", {
    p_store_id: store.id,
  });
  if (!isOwner) redirect("/");

  const [{ data: rows }, responders, requestTypes, { data: modelRow }] = await Promise.all([
    supabase.from("agent_config").select("key, value").eq("store_id", store.id),
    listResponders(),
    listRequestTypes(),
    supabase.from("stores").select("model_provider, model_name").eq("id", store.id).maybeSingle(),
  ]);

  const config: Record<string, string> = {};
  for (const r of rows ?? []) config[r.key] = r.value ?? "";

  // What a responder can subscribe to: the two built-in events, whatever subjects
  // this account routes escalations by, and any request types it defined.
  //
  // "approval" was missing, which meant held actions notified a topic nobody could
  // ever be subscribed to — the notification went out and reached no one.
  const escalationTopics = (config["escalation_topics"] ?? "")
    .split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 12)
    .map((label) => ({
      key: label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30),
      label,
    }))
    .filter((t) => t.key);

  const topics = [
    { key: "escalation", label: "Anything it can't answer" },
    { key: "approval", label: "Actions awaiting approval" },
    ...escalationTopics,
    ...requestTypes.map((t) => ({ key: t.key, label: t.label })),
  ];

  return (
    <AgentView
      key={store.slug}
      initialConfig={config}
      initialResponders={responders}
      topics={topics}
      storeName={store.name}
      businessType={store.businessType}
      initialModelProvider={(modelRow as { model_provider?: string | null } | null)?.model_provider ?? "gemini"}
      initialModelName={(modelRow as { model_name?: string | null } | null)?.model_name ?? ""}
    />
  );
}
