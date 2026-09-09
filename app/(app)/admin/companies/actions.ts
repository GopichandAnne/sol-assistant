"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Platform-admin operations on accounts. This is where credits enter the system:
 * there is no checkout in this product, so a grant here is the only thing that
 * increases a balance.
 *
 * Every action re-verifies platform-admin server-side — never trust the client.
 */
async function requireAdmin() {
  const ctx = await getSessionContext();
  if (!ctx?.isPlatformAdmin) throw new Error("Not authorized");
  return ctx;
}

export type Result<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };

export type CompanyRow = {
  id: string;
  name: string;
  status: string;
  billingEmail: string | null;
  granted: number;
  spent: number;
  remaining: number;
  threshold: number;
  warned: boolean;
  assistants: { id: string; name: string }[];
};

export async function listCompanies(): Promise<CompanyRow[]> {
  await requireAdmin();
  const db = createAdminClient();

  const [{ data: companies }, { data: wallets }, { data: stores }] = await Promise.all([
    db.from("company").select("id, name, status, billing_email").order("created_at", { ascending: false }),
    db.from("company_wallet").select("company_id, granted_credits, spent_credits, threshold_credits, threshold_fired_at"),
    db.from("stores").select("id, slug, store_display_name, company_id").not("company_id", "is", null),
  ]);

  const walletBy = new Map<string, Record<string, unknown>>();
  for (const w of (wallets ?? []) as Record<string, unknown>[]) {
    walletBy.set(w.company_id as string, w);
  }
  const storesBy = new Map<string, { id: string; name: string }[]>();
  for (const s of (stores ?? []) as { id: string; slug: string; store_display_name: string | null; company_id: string }[]) {
    const list = storesBy.get(s.company_id) ?? [];
    list.push({ id: s.id, name: s.store_display_name || s.slug });
    storesBy.set(s.company_id, list);
  }

  return ((companies ?? []) as { id: string; name: string; status: string; billing_email: string | null }[]).map((c) => {
    const w = walletBy.get(c.id) ?? {};
    const granted = Number(w.granted_credits ?? 0);
    const spent = Number(w.spent_credits ?? 0);
    return {
      id: c.id,
      name: c.name,
      status: c.status,
      billingEmail: c.billing_email,
      granted,
      spent,
      remaining: granted - spent,
      threshold: Number(w.threshold_credits ?? 0),
      warned: !!w.threshold_fired_at,
      assistants: storesBy.get(c.id) ?? [],
    };
  });
}

/** Assistants not yet attached to any account — their usage is recorded but
 *  billed to nobody, so this list is the work queue. */
export async function listUnassignedStores(): Promise<{ id: string; name: string }[]> {
  await requireAdmin();
  const db = createAdminClient();
  const { data } = await db
    .from("stores")
    .select("id, slug, store_display_name")
    .is("company_id", null)
    .order("created_at", { ascending: false });
  return ((data ?? []) as { id: string; slug: string; store_display_name: string | null }[]).map((s) => ({
    id: s.id,
    name: s.store_display_name || s.slug,
  }));
}

export async function createCompany(name: string): Promise<Result<{ id: string }>> {
  await requireAdmin();
  const clean = name.trim();
  if (!clean) return { ok: false, error: "Give the account a name." };
  const db = createAdminClient();
  // company_wallet is provisioned by trigger (migration 0110).
  const { data, error } = await db.from("company").insert({ name: clean }).select("id").single();
  if (error || !data) return { ok: false, error: error?.message ?? "Could not create the account." };
  revalidatePath("/admin/companies");
  return { ok: true, id: data.id as string };
}

/** The only way credits enter the system. Re-arms the low-credit warning when the
 *  grant lifts the balance back above the threshold (see company_grant_credits). */
export async function grantCredits(
  companyId: string,
  credits: number,
  reason: string,
): Promise<Result<{ remaining: number }>> {
  await requireAdmin();
  if (!Number.isFinite(credits) || credits <= 0) return { ok: false, error: "Enter a positive number of credits." };
  const db = createAdminClient();
  const { data, error } = await db.rpc("company_grant_credits", {
    p_company_id: companyId,
    p_credits: Math.floor(credits),
    p_reason: reason.trim() || "grant",
    p_ref: null,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/companies");
  revalidatePath("/billing");
  return { ok: true, remaining: Number((data as { remaining?: number } | null)?.remaining ?? 0) };
}

/** Attach an assistant to an account, so its usage starts being billed there. */
export async function assignStore(storeId: string, companyId: string): Promise<Result> {
  await requireAdmin();
  const db = createAdminClient();
  const { error } = await db.from("stores").update({ company_id: companyId }).eq("id", storeId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/companies");
  return { ok: true };
}

/** Add a person to the account. They become a recipient of low-credit warnings
 *  when no explicit billing email is set. */
export async function addMemberByEmail(
  companyId: string,
  email: string,
  role: "owner" | "admin" | "member",
): Promise<Result> {
  await requireAdmin();
  const clean = email.trim().toLowerCase();
  if (!clean) return { ok: false, error: "Enter an email address." };
  const db = createAdminClient();

  // Resolve to an existing console user. We deliberately don't invite by email —
  // membership grants access to real account data, so the person signs up first.
  const { data: users, error: lookupErr } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (lookupErr) return { ok: false, error: lookupErr.message };
  const user = users?.users?.find((u) => (u.email ?? "").toLowerCase() === clean);
  if (!user) return { ok: false, error: "No console user with that email yet — have them sign up first." };

  const { error } = await db
    .from("company_member")
    .upsert({ company_id: companyId, user_id: user.id, role }, { onConflict: "company_id,user_id" });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/companies");
  return { ok: true };
}
