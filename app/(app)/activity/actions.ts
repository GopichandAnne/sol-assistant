"use server";

import { revalidatePath } from "next/cache";
import { getActiveStore } from "@/lib/store/active-store";
import { callBotAdmin } from "@/lib/knowledge/bot-admin";

export type DecideResult =
  | { ok: true; completed: boolean; told: boolean; note?: string }
  | { ok: false; error: string };

/**
 * Resolve a held action — the owner's side of the hold → approve → act loop.
 *
 * Approving is not a note in a log: it runs the call it approved, as the person it
 * was raised for, and tells them the outcome. That work happens in the edge
 * function, which owns the tool executors and the credentials they decrypt; this
 * action does the authorization and hands it over.
 *
 * The two facts it returns are separate on purpose. `completed` is whether the
 * action actually ran — an approved-but-failed action must never read as done, or
 * an owner will believe a change landed that did not.
 */
export async function decideActionRequest(
  id: string,
  decision: "approved" | "declined",
): Promise<DecideResult> {
  const ctx = await getActiveStore();
  if (!ctx?.active) return { ok: false, error: "Not signed in." };
  const isOwner = ctx.isPlatformAdmin || ctx.active.role === "owner";
  if (!isOwner) return { ok: false, error: "Only an owner can resolve approvals." };

  const res = await callBotAdmin({
    action: "resolve_action",
    store_slug: ctx.active.slug,
    request_id: id,
    decision,
    by: ctx.user.email ?? "an owner",
  });
  if (!res.ok) return { ok: false, error: res.error };

  const data = res.data as { ok?: boolean; completed?: boolean; told?: boolean; note?: string; error?: string };
  if (!data.ok) {
    // A separation-of-duties refusal is not an error to shrug at — it is the
    // control working, so it says exactly that rather than a generic failure.
    if (data.error === "already resolved") return { ok: false, error: "Someone already resolved that one." };
    return { ok: false, error: data.error ?? "Couldn't resolve it." };
  }

  revalidatePath("/activity");
  return { ok: true, completed: !!data.completed, told: !!data.told, note: data.note };
}
