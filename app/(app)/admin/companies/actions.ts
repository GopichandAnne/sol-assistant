"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/database.types";

type AgentKey = Database["public"]["Enums"]["agent_config_key"];

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
  assistants: AssistantRow[];
};

/**
 * How far along one client's assistant actually is.
 *
 * A super-admin running several clients needs to see who is stuck and on what,
 * without switching into each one and reading its checklist. These are the five
 * things that decide whether an assistant is doing anything real: something to
 * answer from, somebody to escalate to, a system to act in, a way for people to
 * reach it, and whether it has been used.
 */
export type AssistantRow = {
  id: string;
  name: string;
  slug: string;
  knowledge: number;
  responders: number;
  tools: number;
  /** Where people can actually reach it today. */
  channels: { teams: boolean; slack: boolean; web: boolean };
  conversations: number;
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
  // Readiness for every assistant at once, rather than a query per row: five
  // small counts across the whole table, bucketed in memory. A super-admin
  // opening this page with twenty clients should not fire a hundred queries.
  const storeRows = (stores ?? []) as { id: string; slug: string; store_display_name: string | null; company_id: string }[];
  const ids = storeRows.map((s) => s.id);
  const slugs = storeRows.map((s) => s.slug);

  const [know, resp, http, mcp, teams, slack, keys, convs] = ids.length === 0
    ? [[], [], [], [], [], [], [], []]
    : await Promise.all([
      db.from("knowledge_index").select("store_id").in("store_id", ids).then((r) => r.data ?? []),
      db.from("store_responders").select("store_slug").in("store_slug", slugs).eq("active", true).then((r) => r.data ?? []),
      db.from("http_tool").select("store_id").in("store_id", ids).then((r) => r.data ?? []),
      db.from("mcp_server").select("store_id").in("store_id", ids).eq("enabled", true).then((r) => r.data ?? []),
      db.from("teams_installs").select("store_id").in("store_id", ids).eq("active", true).then((r) => r.data ?? []),
      db.from("slack_installs").select("store_id").in("store_id", ids).eq("active", true).then((r) => r.data ?? []),
      db.from("store_tokens").select("store_id").in("store_id", ids).eq("active", true).like("token", "pk_live_%").then((r) => r.data ?? []),
      db.from("conversations").select("store_slug").in("store_slug", slugs).then((r) => r.data ?? []),
    ]);

  const tally = (rows: unknown[], key: string) => {
    const m = new Map<string, number>();
    for (const r of rows as Record<string, string>[]) m.set(r[key], (m.get(r[key]) ?? 0) + 1);
    return m;
  };
  const knowN = tally(know, "store_id");
  const respN = tally(resp, "store_slug");
  const httpN = tally(http, "store_id");
  const mcpN = tally(mcp, "store_id");
  const teamsN = tally(teams, "store_id");
  const slackN = tally(slack, "store_id");
  const keyN = tally(keys, "store_id");
  const convN = tally(convs, "store_slug");

  const storesBy = new Map<string, AssistantRow[]>();
  for (const s of storeRows) {
    const list = storesBy.get(s.company_id) ?? [];
    list.push({
      id: s.id,
      slug: s.slug,
      name: s.store_display_name || s.slug,
      knowledge: knowN.get(s.id) ?? 0,
      responders: respN.get(s.slug) ?? 0,
      tools: (httpN.get(s.id) ?? 0) + (mcpN.get(s.id) ?? 0),
      channels: {
        teams: (teamsN.get(s.id) ?? 0) > 0,
        slack: (slackN.get(s.id) ?? 0) > 0,
        web: (keyN.get(s.id) ?? 0) > 0,
      },
      conversations: convN.get(s.slug) ?? 0,
    });
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

/* ── Provisioning a client, in one action ────────────────────────────────────
 * Standing a client up used to mean four screens and a wrong default: create the
 * account here, create the assistant on the stores page (seeded from a retail
 * business-type preset), come back to attach it, then invite an owner, then
 * switch into it and configure everything by hand.
 *
 * A super-admin setting up a client should do it once, from one form, and get an
 * assistant that already knows what job it is for. So this creates the account,
 * the assistant seeded from one of the internal-ops blueprints, the setup plan
 * that drives their checklist, the opening credit grant, and the client's own
 * owner — in that order, so a failure never leaves an assistant billed to nobody.
 * -------------------------------------------------------------------------- */

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

export type ProvisionInput = {
  /** The client organisation. Becomes the account name and the default assistant name. */
  companyName: string;
  /** Optional: when the assistant is named for its job rather than the client. */
  assistantName?: string;
  /** One of lib/assistant-templates — decides the brief, approvals and systems. */
  templateKey: string;
  /** The client's own administrator. Invited as owner of both account and assistant. */
  adminEmail?: string;
  /** Opening credit grant, so the assistant can answer before anyone talks billing. */
  credits?: number;
};

export async function provisionClient(
  input: ProvisionInput,
): Promise<Result<{ companyId: string; storeId: string; slug: string; invited: boolean; warnings: string[] }>> {
  await requireAdmin();
  const { templateByKey } = await import("@/lib/assistant-templates");
  const { presetConfig } = await import("@/lib/business-presets");

  const companyName = input.companyName.trim();
  if (!companyName) return { ok: false, error: "Enter the client's name." };
  const t = templateByKey(input.templateKey);
  if (!t) return { ok: false, error: "Pick what the assistant is for." };
  const assistantName = (input.assistantName ?? "").trim() || companyName;

  const db = createAdminClient();
  const warnings: string[] = [];

  const base = slugify(assistantName) || "assistant";
  let slug = base;
  for (let i = 0; i < 6; i++) {
    const { data: ex } = await db.from("stores").select("id").eq("slug", slug).maybeSingle();
    if (!ex) break;
    slug = `${base}-${Math.random().toString(36).slice(2, 5)}`;
  }

  // The account first: it owns the credit pool, and an assistant without one
  // records usage billed to nobody.
  const { data: company, error: companyErr } = await db
    .from("company").insert({ name: companyName }).select("id").single();
  if (companyErr || !company) return { ok: false, error: companyErr?.message ?? "Could not create the account." };

  const { data: store, error: storeErr } = await db
    .from("stores")
    .insert({
      slug,
      store_display_name: assistantName,
      business_type: "saas",
      company_id: company.id,
      active: true,
      whatsapp_status: "inactive",
    })
    .select("id, slug")
    .single();
  if (storeErr || !store) return { ok: false, error: storeErr?.message ?? "Could not create the assistant." };

  // The blueprint's brief, personality and opening line — the same seeding the
  // self-serve flow does, so a provisioned assistant is not a second-class one.
  const merged: Partial<Record<AgentKey, string>> = { ...presetConfig("saas", assistantName) };
  merged.personality = `${t.personality}\n\nOpen new conversations with something like: "${t.greeting}"`;
  merged.store_prompt = `${t.assistantPrompt}\n\nCommon things people ask: ${t.suggestionChips.join("; ")}.`;
  merged.suggestion_chips = t.suggestionChips.join("\n");
  const cfgRows = Object.entries(merged).map(([key, value]) => ({ store_id: store.id, key: key as AgentKey, value }));
  const { error: cfgErr } = await db.from("agent_config").insert(cfgRows);
  if (cfgErr) warnings.push(`Config not fully seeded: ${cfgErr.message}`);

  // The plan behind their setup checklist — including the approvals the blueprint
  // says should never happen without a person.
  const { error: setupErr } = await db.from("assistant_setup").insert({
    store_id: store.id,
    job: t.job,
    channel: "teams",
    systems: t.systems,
    approvals: t.approvals,
    serves: t.serves,
  });
  if (setupErr) warnings.push(`Setup plan not recorded: ${setupErr.message}`);

  if (input.credits && input.credits > 0) {
    const { error: grantErr } = await db.rpc("company_grant_credits", {
      p_company_id: company.id,
      p_credits: Math.floor(input.credits),
      p_reason: "opening grant",
      p_ref: null,
    });
    if (grantErr) warnings.push(`Credits not granted: ${grantErr.message}`);
  }

  // The client's own administrator. Invited rather than required to exist, because
  // provisioning usually happens before they have ever opened the console.
  let invited = false;
  const email = (input.adminEmail ?? "").trim().toLowerCase();
  if (email) {
    const { data: users } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
    let userId = users?.users?.find((u) => (u.email ?? "").toLowerCase() === email)?.id ?? null;
    if (!userId) {
      const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "https://sol-assistant.vercel.app").replace(/\/$/, "");
      const { data: inv, error: invErr } = await db.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${appUrl}/auth/callback?next=/`,
      });
      if (invErr) warnings.push(`Couldn't invite ${email}: ${invErr.message}`);
      else { userId = inv?.user?.id ?? null; invited = true; }
    }
    if (userId) {
      const { error: staffErr } = await db.from("staff")
        .insert({ user_id: userId, store_id: store.id, role: "owner", status: "active" });
      if (staffErr) warnings.push(`Owner not linked to the assistant: ${staffErr.message}`);
      const { error: memberErr } = await db.from("company_member")
        .insert({ company_id: company.id, user_id: userId, role: "owner" });
      if (memberErr) warnings.push(`Owner not added to the account: ${memberErr.message}`);
    }
  }

  revalidatePath("/admin/companies");
  revalidatePath("/admin/stores");
  return { ok: true, companyId: company.id, storeId: store.id, slug: store.slug, invited, warnings };
}
