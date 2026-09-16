"use server";

import { revalidatePath } from "next/cache";
import { getActiveStore } from "@/lib/store/active-store";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { untyped } from "@/lib/supabase/untyped";

async function requireOwner() {
  const ctx = await getActiveStore();
  if (!ctx?.active) throw new Error("No active store.");
  const supabase = await createClient();
  const { data: isOwner } = await supabase.rpc("user_is_owner", { p_store_id: ctx.active.id });
  if (!isOwner) throw new Error("Owners only.");
  return ctx.active;
}

/**
 * Let small calls to an API tool run without a person, and keep big ones waiting.
 *
 * The same rule trackers have, for tools built from an API: below the number it
 * runs, at or above it a person approves, and a call where the number cannot be
 * read waits. Clearing the number puts the tool back to waiting on every call.
 *
 * The field has to be one of the tool's own parameters. A threshold pointed at a
 * field the tool never sends would read nothing on every call, and "unreadable
 * waits" would quietly turn the limit into "hold everything".
 */
export async function setApiToolThreshold(
  toolId: string,
  autoBelow: number | null,
  amountField: string,
): Promise<{ ok: boolean; error?: string }> {
  const store = await requireOwner();
  const from = untyped(createAdminClient());

  const { data: tool } = await from("http_tool")
    .select("id, side_effect, params").eq("id", toolId).eq("store_id", store.id).maybeSingle();
  if (!tool) return { ok: false, error: "That tool no longer exists." };
  if (!tool.side_effect) return { ok: false, error: "Only tools that change something need a limit." };

  if (autoBelow == null) {
    const { error } = await from("http_tool")
      .update({ auto_below: null, amount_field: null }).eq("id", toolId).eq("store_id", store.id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/connections");
    return { ok: true };
  }

  if (!Number.isFinite(autoBelow) || autoBelow <= 0) {
    return { ok: false, error: "The limit has to be a number above zero." };
  }
  const field = amountField.trim();
  const known = Object.keys((tool.params as { properties?: Record<string, unknown> } | null)?.properties ?? {});
  if (!field || !known.includes(field)) {
    return { ok: false, error: "Pick which of this tool's fields holds the amount." };
  }

  const { error } = await from("http_tool")
    .update({ auto_below: autoBelow, amount_field: field }).eq("id", toolId).eq("store_id", store.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/connections");
  return { ok: true };
}
