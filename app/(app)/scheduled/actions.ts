"use server";

import { revalidatePath } from "next/cache";
import { getActiveStore } from "@/lib/store/active-store";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { untyped } from "@/lib/supabase/untyped";

export type Schedule = "hourly" | "daily" | "weekdays";

export type Trigger = {
  id: string;
  name: string;
  instruction: string;
  schedule: Schedule;
  atHour: number;
  runsAs: string;
  active: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
};

export type Run = {
  id: string;
  triggerName: string;
  runsAs: string | null;
  startedAt: string;
  finishedAt: string | null;
  status: "ok" | "held" | "error";
  detail: string | null;
  toolsUsed: number;
  actionsHeld: number;
};

async function requireOwner() {
  const ctx = await getActiveStore();
  if (!ctx?.active) throw new Error("No active store.");
  const supabase = await createClient();
  const { data: isOwner } = await supabase.rpc("user_is_owner", { p_store_id: ctx.active.id });
  if (!isOwner) throw new Error("Owners only.");
  return ctx.active;
}

export async function listTriggers(): Promise<Trigger[]> {
  const store = await requireOwner();
  const from = untyped(createAdminClient());
  const { data } = await from("agent_trigger")
    .select("id, name, instruction, schedule, at_hour, runs_as, active, last_run_at, next_run_at")
    .eq("store_id", store.id)
    .order("created_at", { ascending: false });
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    instruction: String(r.instruction),
    schedule: r.schedule as Schedule,
    atHour: Number(r.at_hour ?? 9),
    runsAs: String(r.runs_as ?? ""),
    active: !!r.active,
    lastRunAt: (r.last_run_at as string | null) ?? null,
    nextRunAt: (r.next_run_at as string | null) ?? null,
  }));
}

export async function listRuns(limit = 40): Promise<Run[]> {
  const store = await requireOwner();
  const from = untyped(createAdminClient());
  const { data } = await from("agent_run")
    .select("id, trigger_name, runs_as, started_at, finished_at, status, detail, tools_used, actions_held")
    .eq("store_id", store.id)
    .order("started_at", { ascending: false })
    .limit(limit);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    triggerName: String(r.trigger_name ?? "—"),
    runsAs: (r.runs_as as string | null) ?? null,
    startedAt: String(r.started_at),
    finishedAt: (r.finished_at as string | null) ?? null,
    status: (r.status as Run["status"]) ?? "ok",
    detail: (r.detail as string | null) ?? null,
    toolsUsed: Number(r.tools_used ?? 0),
    actionsHeld: Number(r.actions_held ?? 0),
  }));
}

export async function createTrigger(input: {
  name: string;
  instruction: string;
  schedule: Schedule;
  atHour: number;
  runsAs: string;
}): Promise<{ ok: boolean; error?: string }> {
  const store = await requireOwner();
  const name = input.name.trim();
  const instruction = input.instruction.trim();
  const runsAs = input.runsAs.trim().toLowerCase();
  if (!name) return { ok: false, error: "Give it a name." };
  if (!instruction) return { ok: false, error: "Say what it should do." };
  // An address, because everything this thing does will be attributed to it. A
  // scheduled job with no named owner is an action nobody can be asked about.
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(runsAs)) {
    return { ok: false, error: "Needs a person's email address to act as." };
  }
  const from = untyped(createAdminClient());
  const { error } = await from("agent_trigger").insert({
    store_id: store.id,
    name,
    instruction,
    schedule: input.schedule,
    at_hour: Math.min(23, Math.max(0, Math.round(input.atHour))),
    runs_as: runsAs,
    // Left at the default (now), so the first run happens within a few minutes
    // rather than tomorrow morning. Finding out straight away whether an
    // instruction does what you meant is worth more than a tidy first schedule,
    // and every run after this one is on time.
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/scheduled");
  return { ok: true };
}

export async function setTriggerActive(id: string, active: boolean): Promise<{ ok: boolean; error?: string }> {
  const store = await requireOwner();
  const from = untyped(createAdminClient());
  const { error } = await from("agent_trigger").update({ active }).eq("id", id).eq("store_id", store.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/scheduled");
  return { ok: true };
}

export async function deleteTrigger(id: string): Promise<{ ok: boolean; error?: string }> {
  const store = await requireOwner();
  const from = untyped(createAdminClient());
  const { error } = await from("agent_trigger").delete().eq("id", id).eq("store_id", store.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/scheduled");
  return { ok: true };
}
