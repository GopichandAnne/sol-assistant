"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Credits, at the ACCOUNT level.
 *
 * An account (company) holds one pool of credits shared by every assistant it
 * owns. Credits are GRANTED — there is no payment processor in this product —
 * so the owner-facing job here is: show the balance, show where it went, and let
 * them set the level at which they want warning. Crossing that level emails the
 * account; it never stops an assistant.
 *
 * Balance is derived (granted - spent) rather than stored, so it cannot drift
 * from company_ledger. See migrations 0110/0111.
 */

async function requireStoreAccess(storeId: string) {
  const ctx = await getSessionContext();
  const allowed =
    !!ctx && (ctx.isPlatformAdmin || ctx.stores.some((s) => s.id === storeId && s.role === "owner"));
  if (!allowed) throw new Error("Not authorized");
  return ctx!;
}

/** Owner-or-admin access to a company, verified through a store they own. */
async function requireCompanyAccess(companyId: string) {
  const ctx = await getSessionContext();
  if (!ctx) throw new Error("Not authorized");
  if (ctx.isPlatformAdmin) return ctx;
  const db = createAdminClient();
  const { data } = await db
    .from("company_member")
    .select("role")
    .eq("company_id", companyId)
    .eq("user_id", ctx.user.id)
    .maybeSingle();
  const role = (data as { role?: string } | null)?.role;
  if (role !== "owner" && role !== "admin") throw new Error("Not authorized");
  return ctx;
}

export type CompanyView = {
  id: string;
  name: string;
  billingEmail: string | null;
};

/** The account an assistant belongs to. Null while it is unassigned — usage is
 *  still recorded for it, just not billed to anyone. */
export async function getCompanyForStore(storeId: string): Promise<CompanyView | null> {
  await requireStoreAccess(storeId);
  const db = createAdminClient();
  const { data: store } = await db
    .from("stores")
    .select("company_id")
    .eq("id", storeId)
    .maybeSingle();
  const companyId = (store as { company_id?: string } | null)?.company_id;
  if (!companyId) return null;

  const { data } = await db
    .from("company")
    .select("id, name, billing_email")
    .eq("id", companyId)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id as string,
    name: (data.name as string) ?? "",
    billingEmail: (data.billing_email as string | null) ?? null,
  };
}

export type CreditsView = {
  granted: number;
  spent: number;
  remaining: number;
  threshold: number;
  /** Set when the low-credit warning has fired and not yet been re-armed by a grant. */
  warned: boolean;
  totalCostUsd: number;
};

export async function getCredits(companyId: string): Promise<CreditsView> {
  await requireCompanyAccess(companyId);
  const db = createAdminClient();
  const { data } = await db
    .from("company_wallet")
    .select("granted_credits, spent_credits, threshold_credits, threshold_fired_at, total_cost_usd")
    .eq("company_id", companyId)
    .maybeSingle();
  const w = data ?? {
    granted_credits: 0, spent_credits: 0, threshold_credits: 0,
    threshold_fired_at: null, total_cost_usd: 0,
  };
  const granted = Number(w.granted_credits ?? 0);
  const spent = Number(w.spent_credits ?? 0);
  return {
    granted,
    spent,
    remaining: granted - spent,
    threshold: Number(w.threshold_credits ?? 0),
    warned: !!w.threshold_fired_at,
    totalCostUsd: Number(w.total_cost_usd ?? 0),
  };
}

export type LedgerRow = {
  ts: string;
  delta: number;
  reason: string;
  /** Which assistant spent it — null for account-level movements like a grant. */
  assistant: string | null;
};

export async function getLedger(companyId: string): Promise<LedgerRow[]> {
  await requireCompanyAccess(companyId);
  const db = createAdminClient();
  const { data } = await db
    .from("company_ledger")
    .select("ts, delta, reason, store_id")
    .eq("company_id", companyId)
    .order("ts", { ascending: false })
    .limit(50);
  const rows = (data ?? []) as { ts: string; delta: number; reason: string; store_id: string | null }[];

  // Resolve the handful of assistant names in one round-trip rather than per row.
  const ids = [...new Set(rows.map((r) => r.store_id).filter((v): v is string => !!v))];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: stores } = await db
      .from("stores")
      .select("id, slug, store_display_name")
      .in("id", ids);
    for (const s of (stores ?? []) as { id: string; slug: string; store_display_name: string | null }[]) {
      names.set(s.id, s.store_display_name || s.slug);
    }
  }

  return rows.map((r) => ({
    ts: r.ts,
    delta: Number(r.delta),
    reason: r.reason ?? "",
    assistant: r.store_id ? names.get(r.store_id) ?? null : null,
  }));
}

export type AssistantSpend = { assistant: string; credits: number };

/** Where the pool went, per assistant, over the last 30 days. This is why
 *  usage_event stayed keyed by store when the balance moved up to the account. */
export async function getSpendByAssistant(companyId: string): Promise<AssistantSpend[]> {
  await requireCompanyAccess(companyId);
  const db = createAdminClient();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await db
    .from("company_ledger")
    .select("delta, store_id")
    .eq("company_id", companyId)
    .lt("delta", 0)
    .gte("ts", since);
  const rows = (data ?? []) as { delta: number; store_id: string | null }[];
  if (!rows.length) return [];

  const byStore = new Map<string, number>();
  for (const r of rows) {
    if (!r.store_id) continue;
    byStore.set(r.store_id, (byStore.get(r.store_id) ?? 0) + Math.abs(Number(r.delta)));
  }
  if (!byStore.size) return [];

  const { data: stores } = await db
    .from("stores")
    .select("id, slug, store_display_name")
    .in("id", [...byStore.keys()]);
  const names = new Map<string, string>();
  for (const s of (stores ?? []) as { id: string; slug: string; store_display_name: string | null }[]) {
    names.set(s.id, s.store_display_name || s.slug);
  }

  return [...byStore.entries()]
    .map(([id, credits]) => ({ assistant: names.get(id) ?? "Unknown", credits }))
    .sort((a, b) => b.credits - a.credits);
}

export type Result = { ok: true } | { ok: false; error: string };

/** The level at which the account wants warning. Nothing stops at zero. */
export async function setThreshold(companyId: string, credits: number): Promise<Result> {
  await requireCompanyAccess(companyId);
  if (!Number.isFinite(credits) || credits < 0) return { ok: false, error: "Enter a number of credits, 0 or more." };
  const db = createAdminClient();
  const { error } = await db
    .from("company_wallet")
    .update({ threshold_credits: Math.floor(credits), updated_at: new Date().toISOString() })
    .eq("company_id", companyId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/billing");
  return { ok: true };
}

export async function setBillingEmail(companyId: string, email: string): Promise<Result> {
  await requireCompanyAccess(companyId);
  const clean = email.trim();
  if (clean && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) {
    return { ok: false, error: "That doesn't look like an email address." };
  }
  const db = createAdminClient();
  const { error } = await db
    .from("company")
    .update({ billing_email: clean || null, updated_at: new Date().toISOString() })
    .eq("id", companyId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/billing");
  return { ok: true };
}
