"use server";

import { revalidatePath } from "next/cache";
import { getActiveStore } from "@/lib/store/active-store";
import { createAdminClient } from "@/lib/supabase/admin";
import { untyped } from "@/lib/supabase/untyped";

/**
 * Answers colleagues said were wrong.
 *
 * The audit log answers "what did it do". This answers "was it right", which is
 * the question owners actually cannot get at, and the most common reason these
 * projects are abandoned.
 */

export type Feedback = {
  id: string;
  question: string | null;
  answer: string | null;
  note: string | null;
  channel: string | null;
  reportedBy: string | null;
  createdAt: string;
};

async function requireOwner() {
  const ctx = await getActiveStore();
  if (!ctx?.active) throw new Error("Not signed in.");
  const isOwner = ctx.isPlatformAdmin || ctx.active.role === "owner";
  if (!isOwner) throw new Error("Owners only.");
  return ctx;
}

export async function listOpenFeedback(): Promise<Feedback[]> {
  const ctx = await requireOwner();
  const db = createAdminClient();
  const from = untyped(db);
  const { data } = await from("answer_feedback")
    .select("id, question, answer, note, channel, reported_by, created_at")
    .eq("store_id", ctx.active!.id).eq("status", "open")
    .order("created_at", { ascending: false }).limit(20);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => ({
    id: r.id, question: r.question, answer: r.answer, note: r.note,
    channel: r.channel, reportedBy: r.reported_by, createdAt: r.created_at,
  }));
}

/** Mark one as dealt with. Records who, because "reviewed by nobody" is how a
 *  queue quietly becomes decoration. */
export async function markReviewed(id: string): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireOwner();
  const db = createAdminClient();
  const from = untyped(db);
  const { error } = await from("answer_feedback")
    .update({ status: "reviewed", reviewed_at: new Date().toISOString(), reviewed_by: ctx.user.email ?? "an owner" })
    .eq("id", id).eq("store_id", ctx.active!.id).eq("status", "open");
  if (error) return { ok: false, error: error.message };
  revalidatePath("/health");
  return { ok: true };
}
