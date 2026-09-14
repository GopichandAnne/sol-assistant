"use server";

import { revalidatePath } from "next/cache";
import { getActiveStore } from "@/lib/store/active-store";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { untyped } from "@/lib/supabase/untyped";

export type Tracker = {
  id: string;
  name: string;
  purpose: string;
  fileUrl: string;
  tableName: string;
  writable: boolean;
  connectedBy: string;
  lastError: string | null;
  /** hold = every write waits for a person, whatever its size. */
  actionPolicy: "auto" | "hold";
  autoBelow: number | null;
  amountField: string | null;
};

async function requireOwner() {
  const ctx = await getActiveStore();
  if (!ctx?.active) throw new Error("No active store.");
  const supabase = await createClient();
  const { data: isOwner } = await supabase.rpc("user_is_owner", { p_store_id: ctx.active.id });
  if (!isOwner) throw new Error("Owners only.");
  return ctx.active;
}

export async function listTrackers(): Promise<Tracker[]> {
  const store = await requireOwner();
  const from = untyped(createAdminClient());
  const { data } = await from("workbook_source")
    .select("id, name, purpose, file_url, table_name, writable, connected_by, last_error, action_policy, auto_below, amount_field")
    .eq("store_id", store.id)
    .order("created_at", { ascending: true });
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    purpose: String(r.purpose ?? ""),
    fileUrl: String(r.file_url),
    tableName: String(r.table_name ?? "Table1"),
    writable: !!r.writable,
    connectedBy: String(r.connected_by ?? ""),
    lastError: (r.last_error as string | null) ?? null,
    actionPolicy: (r.action_policy as "auto" | "hold") ?? "hold",
    autoBelow: r.auto_below == null ? null : Number(r.auto_below),
    amountField: (r.amount_field as string | null) ?? null,
  }));
}

export async function addTracker(input: {
  name: string;
  purpose: string;
  fileUrl: string;
  tableName: string;
  connectedBy: string;
  writable: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  const store = await requireOwner();
  const name = input.name.trim();
  const purpose = input.purpose.trim();
  const fileUrl = input.fileUrl.trim();
  const who = input.connectedBy.trim().toLowerCase();

  if (!name) return { ok: false, error: "Give it a name — it's what people will call it." };
  // The purpose is what the model reads when deciding whether this is the right
  // table to open. Without it, a tracker is a name with no meaning attached and
  // gets reached for at random.
  if (!purpose) return { ok: false, error: "Say what it's for, in one line." };
  if (!/^https?:\/\//i.test(fileUrl)) return { ok: false, error: "Paste the link to the spreadsheet." };
  if (who && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(who)) {
    return { ok: false, error: "That doesn't look like an email address." };
  }

  const from = untyped(createAdminClient());
  const { error } = await from("workbook_source").insert({
    store_id: store.id,
    name,
    purpose,
    file_url: fileUrl,
    table_name: input.tableName.trim() || "Table1",
    connected_by: who,
    writable: input.writable,
  });
  if (error) {
    if (error.code === "23505") return { ok: false, error: "There's already a tracker with that name." };
    return { ok: false, error: error.message };
  }
  revalidatePath("/connections");
  return { ok: true };
}

/** Turning writing on is the consequential switch here: it is what lets the
 *  assistant propose changes to a real record. Approval still applies to every
 *  write — this decides whether it may ask at all. */
export async function setTrackerWritable(id: string, writable: boolean): Promise<{ ok: boolean; error?: string }> {
  const store = await requireOwner();
  const from = untyped(createAdminClient());
  const { error } = await from("workbook_source").update({ writable }).eq("id", id).eq("store_id", store.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/connections");
  return { ok: true };
}

export async function removeTracker(id: string): Promise<{ ok: boolean; error?: string }> {
  const store = await requireOwner();
  const from = untyped(createAdminClient());
  const { error } = await from("workbook_source").delete().eq("id", id).eq("store_id", store.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/connections");
  return { ok: true };
}

/**
 * How big a write has to be before a person decides.
 *
 * Leaving the limit empty means every write waits, which is the safe default and
 * the one most accounts should stay on. Setting one is the owner saying small
 * ones are fine, and it needs the column carrying the number: without that we
 * cannot tell a large change from a small one, and anything we cannot measure
 * waits.
 */
export async function setTrackerThreshold(
  id: string,
  autoBelow: number | null,
  amountField: string,
): Promise<{ ok: boolean; error?: string }> {
  const store = await requireOwner();
  const field = amountField.trim();
  if (autoBelow != null && !field) {
    return { ok: false, error: "Say which column holds the amount, or leave the limit empty." };
  }
  if (autoBelow != null && !(autoBelow > 0)) {
    return { ok: false, error: "The limit has to be a number above zero." };
  }
  const from = untyped(createAdminClient());
  const { error } = await from("workbook_source")
    .update({
      auto_below: autoBelow,
      amount_field: autoBelow == null ? null : field,
      action_policy: autoBelow == null ? "hold" : "auto",
    })
    .eq("id", id).eq("store_id", store.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/connections");
  return { ok: true };
}
