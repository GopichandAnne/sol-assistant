"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveStore } from "@/lib/store/active-store";
import { callBotAdmin } from "@/lib/knowledge/bot-admin";
import { BUSINESS_PRESETS } from "@/lib/business-presets";
import type { Database } from "@/lib/database.types";
import { untyped } from "@/lib/supabase/untyped";

type AgentKey = Database["public"]["Enums"]["agent_config_key"];

export type SaveResult = { ok: true } | { ok: false; error: string };

/** Keys the Agent Setup screen may write. */
const EDITABLE: AgentKey[] = [
  "personality",
  "store_prompt",
  "language_handling",
  "engage_info",
  "off_topic_handling",
  "followup_enabled",
  "followup_minutes",
  "history_turns",
  "tts_voice",
  "tts_enabled",
  "streak_goal",
  "streak_bonus_cents",
  "streak_cap_cents",
];

/**
 * Save one or more agent_config values for the active store (owners only).
 * Each key upserts agent_config (RLS also enforces owner) with a bumped version,
 * and appends an agent_config_history row (service role — clients can't write
 * history) for revertability.
 */
export async function saveAgentConfig(
  fields: Record<string, string>,
): Promise<SaveResult> {
  const ctx = await getActiveStore();
  if (!ctx?.active) return { ok: false, error: "No active store." };

  const supabase = await createClient();
  const { data: isOwner } = await supabase.rpc("user_is_owner", {
    p_store_id: ctx.active.id,
  });
  if (!isOwner) return { ok: false, error: "Only owners can edit the agent." };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const admin = createAdminClient();
  const editable = new Set<string>(EDITABLE);

  for (const [key, raw] of Object.entries(fields)) {
    if (!editable.has(key)) continue;
    const value = (raw ?? "").toString();

    if ((key === "followup_minutes" || key === "history_turns") && value.trim() !== "") {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) {
        return { ok: false, error: `${key.replace("_", " ")} must be a positive number.` };
      }
    }

    const { data: cur } = await supabase
      .from("agent_config")
      .select("version")
      .eq("store_id", ctx.active.id)
      .eq("key", key as AgentKey)
      .maybeSingle();
    const version = (cur?.version ?? 0) + 1;

    const { data: up, error } = await supabase
      .from("agent_config")
      .upsert(
        { store_id: ctx.active.id, key: key as AgentKey, value, version, updated_by: user?.id ?? null },
        { onConflict: "store_id,key" },
      )
      .select("id")
      .single();
    if (error) return { ok: false, error: error.message };

    await admin.from("agent_config_history").insert({
      config_id: up.id,
      store_id: ctx.active.id,
      key: key as AgentKey,
      value,
      version,
      updated_by: user?.id ?? null,
    });
  }

  revalidatePath("/agent");
  return { ok: true };
}

/**
 * Let an owner set their store's business type themselves (previously admin-only).
 * Drives the vertical vocabulary layer + any type-gated UI. Non-destructive: it
 * only changes stores.business_type — the owner's agent_config wording is left as
 * they've tuned it. Revalidates the whole layout so the nav + labels relabel.
 */
export async function updateBusinessType(businessType: string): Promise<SaveResult> {
  const ctx = await getActiveStore();
  if (!ctx?.active) return { ok: false, error: "No active store." };

  const supabase = await createClient();
  const { data: isOwner } = await supabase.rpc("user_is_owner", { p_store_id: ctx.active.id });
  if (!isOwner) return { ok: false, error: "Only owners can change the business type." };

  if (!BUSINESS_PRESETS.some((p) => p.id === businessType)) {
    return { ok: false, error: "Unknown business type." };
  }

  const admin = createAdminClient();
  const { error } = await admin.from("stores").update({ business_type: businessType }).eq("id", ctx.active.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/", "layout");
  return { ok: true };
}

// ── Model choice: which LLM answers this store's chat ─────────────────────────
// NULL provider ⇒ Gemini (the default). Platform keys power the alternatives.
export async function saveModelChoice(provider: string, model: string | null): Promise<SaveResult> {
  const ctx = await getActiveStore();
  if (!ctx?.active) return { ok: false, error: "No active store." };

  const supabase = await createClient();
  const { data: isOwner } = await supabase.rpc("user_is_owner", { p_store_id: ctx.active.id });
  if (!isOwner) return { ok: false, error: "Only owners can change the model." };

  const p = ["gemini", "anthropic", "openai"].includes(provider) ? provider : "gemini";
  const admin = createAdminClient();
  const { error } = await admin
    .from("stores")
    .update({
      // Store the provider explicitly (incl. 'gemini') so the pick round-trips;
      // NULL model_name ⇒ that provider's default model. Legacy NULL provider
      // still resolves to Gemini in the dispatcher, so nothing breaks.
      model_provider: p,
      model_name: model || null,
    })
    .eq("id", ctx.active.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/agent");
  return { ok: true };
}

// ── Premium diner voice (OpenAI TTS) ──────────────────────────────────────────
export type VoiceSettings = { voice: string; enabled: boolean; slug: string; token: string | null };

/** Current premium-voice settings for the active store, plus the slug + a primary
 *  visitor token so the owner card can PREVIEW a voice through the tts function. */
export async function getVoiceSettings(): Promise<VoiceSettings> {
  const ctx = await getActiveStore();
  if (!ctx?.active) return { voice: "aria", enabled: true, slug: "", token: null };
  const admin = createAdminClient();
  const { data } = await admin
    .from("agent_config")
    .select("key, value")
    .eq("store_id", ctx.active.id)
    .in("key", ["tts_voice", "tts_enabled"]);
  const conf = Object.fromEntries((data ?? []).map((r) => [r.key, String(r.value ?? "")]));
  const { data: tok } = await admin
    .from("store_tokens")
    .select("token")
    .eq("store_id", ctx.active.id)
    .eq("active", true)
    .is("listing_ref", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return {
    voice: (conf.tts_voice || "aria").toLowerCase(),
    enabled: (conf.tts_enabled ?? "true").toLowerCase() !== "false",
    slug: ctx.active.slug,
    token: tok?.token ?? null,
  };
}

// ── Escalation responders ─────────────────────────────────────────────────────
export type Responder = Database["public"]["Tables"]["store_responders"]["Row"];
export type ResponderResult =
  | { ok: true; responder: Responder }
  | { ok: false; error: string };

/** Normalize a phone to digits only (E.164 without '+', matching WhatsApp 'from'). */
function normalizePhone(raw: string): string {
  return (raw || "").replace(/[^0-9]/g, "");
}

export async function listResponders(): Promise<Responder[]> {
  const ctx = await getActiveStore();
  if (!ctx?.active) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("store_responders")
    .select("*")
    .eq("store_slug", ctx.active.slug)
    .order("created_at", { ascending: true });
  return (data ?? []) as Responder[];
}

export async function addResponder(input: {
  email?: string;
  name?: string;
  role?: "owner" | "staff";
  topics?: string[];
}): Promise<ResponderResult> {
  // Email is the address: it reaches them by mail, and it is also how they are
  // found in Teams (teams_user) and Slack (users.lookupByEmail).
  const email = (input.email ?? "").trim().toLowerCase();
  if (!email) return { ok: false, error: "Add their email address." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, error: "Enter a valid email address." };
  }

  const ctx = await getActiveStore();
  if (!ctx?.active) return { ok: false, error: "No active store." };
  const supabase = await createClient();
  const { data: isOwner } = await supabase.rpc("user_is_owner", { p_store_id: ctx.active.id });
  if (!isOwner) return { ok: false, error: "Only owners can manage responders." };

  const { data, error } = await supabase
    .from("store_responders")
    .upsert(
      {
        store_slug: ctx.active.slug,
        email,
        name: (input.name ?? "").trim() || null,
        role: input.role ?? "staff",
        topics: input.topics ?? ["escalation"],
        active: true,
      },
      { onConflict: "store_slug,email" },
    )
    .select("*")
    .single();
  if (error) return { ok: false, error: error.message };
  revalidatePath("/agent");
  return { ok: true, responder: data as Responder };
}

export async function updateResponder(
  id: string,
  patch: Partial<Pick<Responder, "active" | "topics">>,
): Promise<ResponderResult> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("store_responders")
    .update(patch)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Responder not found (owners only)." };
  revalidatePath("/agent");
  return { ok: true, responder: data as Responder };
}

export async function removeResponder(id: string): Promise<SaveResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("store_responders").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/agent");
  return { ok: true };
}

// ── Charges & fees (tax, delivery, service…) ──────────────────────────────────
export type Charge = {
  id?: string;
  label: string;
  kind: "percent" | "flat";
  value: number;
  applies_to: "all" | "pickup" | "delivery";
  enabled: boolean;
};

async function ownerSlug(): Promise<{ ok: true; slug: string } | { ok: false; error: string }> {
  const ctx = await getActiveStore();
  if (!ctx?.active) return { ok: false, error: "No active store." };
  const supabase = await createClient();
  const { data: isOwner } = await supabase.rpc("user_is_owner", { p_store_id: ctx.active.id });
  if (!isOwner) return { ok: false, error: "Only owners can manage charges." };
  return { ok: true, slug: ctx.active.slug };
}

export async function listCharges(): Promise<Charge[]> {
  const gate = await ownerSlug();
  if (!gate.ok) return [];
  const res = await callBotAdmin({ action: "list_charges", store_slug: gate.slug });
  if (!res.ok) return [];
  return (res.data.charges as Charge[]) ?? [];
}

export async function saveCharge(input: Charge): Promise<SaveResult> {
  const gate = await ownerSlug();
  if (!gate.ok) return gate;
  if (!input.label.trim()) return { ok: false, error: "Give the charge a name." };
  if (!Number.isFinite(input.value) || input.value < 0) return { ok: false, error: "Value must be a number ≥ 0." };
  const res = await callBotAdmin({ action: "set_charge", store_slug: gate.slug, ...input });
  if (!res.ok) return res;
  revalidatePath("/agent");
  return { ok: true };
}

export async function deleteCharge(id: string): Promise<SaveResult> {
  const gate = await ownerSlug();
  if (!gate.ok) return gate;
  const res = await callBotAdmin({ action: "delete_charge", store_slug: gate.slug, id });
  if (!res.ok) return res;
  revalidatePath("/agent");
  return { ok: true };
}

/* ── The account's own mail sender ───────────────────────────────────────────
 * Notifications leave from the platform's address unless an account configures
 * its own. Its own is better on both counts that matter: a colleague recognises
 * mail from their own domain, and their spam filter trusts it.
 *
 * The password is encrypted before it is stored and never returned. The panel can
 * only learn whether one is set, and replace it.
 * -------------------------------------------------------------------------- */

export type MailSetup = {
  configured: boolean;
  host: string;
  port: number;
  username: string;
  fromAddress: string | null;
  fromName: string | null;
  verifiedAt: string | null;
  lastError: string | null;
};

async function companyOf(storeId: string): Promise<string | null> {
  const db = createAdminClient();
  const { data } = await db.from("stores").select("company_id").eq("id", storeId).maybeSingle();
  return (data as { company_id?: string } | null)?.company_id ?? null;
}

export async function getMailSetup(): Promise<MailSetup | null> {
  const ctx = await getActiveStore();
  if (!ctx?.active) return null;
  const companyId = await companyOf(ctx.active.id);
  if (!companyId) return null;
  const db = createAdminClient();
  // deno-lint ignore: the table isn't in the generated types yet.
  const from = untyped(db);
  const { data } = await from("notification_email")
    .select("host, port, username, from_address, from_name, verified_at, last_error")
    .eq("company_id", companyId).maybeSingle();
  if (!data) {
    return { configured: false, host: "", port: 587, username: "", fromAddress: null, fromName: null, verifiedAt: null, lastError: null };
  }
  return {
    configured: true,
    host: data.host, port: data.port, username: data.username,
    fromAddress: data.from_address, fromName: data.from_name,
    verifiedAt: data.verified_at, lastError: data.last_error,
  };
}

/**
 * Save the account's mail sender. Owner-only: it is a credential, and it decides
 * whose name is on every notification the assistant sends.
 */
export async function saveMailSetup(input: {
  host: string; port: number; username: string;
  /** Omitted when only the other fields are being edited. */
  password?: string;
  fromAddress?: string; fromName?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await getActiveStore();
  if (!ctx?.active) return { ok: false, error: "No active assistant." };
  if (!(ctx.active.role === "owner" || ctx.isPlatformAdmin)) return { ok: false, error: "Owners only." };
  const companyId = await companyOf(ctx.active.id);
  if (!companyId) return { ok: false, error: "This assistant isn't on an account yet." };

  const host = input.host.trim();
  const username = input.username.trim();
  if (!host || !username) return { ok: false, error: "Server and username are both needed." };

  const res = await callBotAdmin({
    action: "set_mail_setup",
    store_slug: ctx.active.slug,
    company_id: companyId,
    host,
    port: Number(input.port) || 587,
    username,
    password: input.password ?? "",
    from_address: input.fromAddress?.trim() || null,
    from_name: input.fromName?.trim() || null,
  });
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath("/agent");
  return { ok: true };
}

/** Send one message to the signed-in person, so "saved" can become "working". */
export async function testMailSetup(): Promise<{ ok: true; to: string } | { ok: false; error: string }> {
  const ctx = await getActiveStore();
  if (!ctx?.active) return { ok: false, error: "No active assistant." };
  const to = ctx.user.email;
  if (!to) return { ok: false, error: "Your account has no email address to send to." };
  const res = await callBotAdmin({ action: "test_mail_setup", store_slug: ctx.active.slug, to });
  if (!res.ok) return { ok: false, error: res.error };
  const d = res.data as { sent?: boolean; error?: string };
  if (!d.sent) return { ok: false, error: d.error ?? "The message didn't go out." };
  revalidatePath("/agent");
  return { ok: true, to };
}
