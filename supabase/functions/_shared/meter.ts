// Usage metering — records real COGS per AI action and debits the COMPANY's credit
// pool (migrations 0110/0111). This is the ONE choke point: every cost-bearing call
// (Gemini chat, embeddings, vision, OpenAI TTS) routes its cost through here.
//
// Design:
//   • Record the RAW UNITS (tokens / chars) in usage_event.units — cost is derived
//     from a CENTRAL pricing table below, so we can re-price history later.
//   • usage_event stays keyed by STORE, so per-assistant burn is still answerable
//     even though the balance is shared across the account's assistants.
//   • Map cost → credits at 1 credit ≈ $0.02 COGS.
//   • Credits are GRANTED, never purchased in-product — there is no processor here.
//     Crossing the warning threshold emails the account; it never stops a reply.
//   • FAIL-OPEN: metering never throws into the caller. A billing hiccup must not
//     block a customer's reply.
//
// Rates are calibration PLACEHOLDERS, env-overridable, and only affect the derived
// cost — the stored units are ground truth. Update the table, not the call sites.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { sendEmail } from "./email.ts";

/** Where a metered call attributes its cost. Pass this into the provider client;
 *  omit it (e.g. health probes, no store) to skip metering entirely. */
export interface MeterCtx {
  svc: SupabaseClient;
  storeId: string;
  kind: string; // 'bot_chat' | 'followup_draft' | 'search_embed' | 'index_embed' | 'catalog_extract' | 'resume_parse' | 'plan_generate' | 'tts' | ...
  ref?: Record<string, unknown>;
}

// ── credit unit (shared with Insights) ───────────────────────────────────────
const CREDIT_COGS_CAP_USD = numEnv("CREDIT_COGS_CAP_USD", 0.02); // 1 credit covers ≤ $0.02 COGS

/** Credits a real USD cost maps to. 0 for free/zero-cost actions. */
export function creditsForCost(costUsd: number): number {
  if (!(costUsd > 0)) return 0;
  return Math.max(1, Math.ceil(costUsd / CREDIT_COGS_CAP_USD));
}

// ── pricing table (USD per 1,000,000 units) — placeholders, env-overridable ──
const PRICE = {
  // Gemini 2.5 Flash (per 1M tokens)
  gemini_in:     numEnv("PRICE_GEMINI_IN_PER_M", 0.30),
  gemini_out:    numEnv("PRICE_GEMINI_OUT_PER_M", 2.50),
  gemini_cached: numEnv("PRICE_GEMINI_CACHED_PER_M", 0.075),
  // gemini-embedding-001 (per 1M input tokens)
  embed_in:      numEnv("PRICE_EMBED_PER_M", 0.15),
  // OpenAI gpt-4o-mini-tts — priced per 1M characters (audio-dominated; approx)
  tts_chars:     numEnv("PRICE_TTS_PER_M_CHARS", 15.0),
};

export interface GeminiUsage {
  inputTokens: number;  // billable (non-cached) prompt tokens
  outputTokens: number; // candidates + thinking
  cachedTokens: number; // cached prefix (cheaper)
  calls: number;        // generateContent round-trips in this turn
}

export function emptyUsage(): GeminiUsage {
  return { inputTokens: 0, outputTokens: 0, cachedTokens: 0, calls: 0 };
}

/** Fold one response's usageMetadata into an accumulator. Gemini reports the TOTAL
 *  prompt tokens including cached, so bill (prompt − cached) at the input rate and
 *  the cached portion at the cheaper cached rate. */
export function addUsage(acc: GeminiUsage, usageMetadata: unknown): GeminiUsage {
  const u = (usageMetadata ?? {}) as Record<string, number>;
  const prompt = num(u.promptTokenCount);
  const cached = num(u.cachedContentTokenCount);
  const output = num(u.candidatesTokenCount) + num(u.thoughtsTokenCount);
  acc.inputTokens += Math.max(0, prompt - cached);
  acc.cachedTokens += cached;
  acc.outputTokens += output;
  acc.calls += 1;
  return acc;
}

/** USD for a Gemini chat/structured turn from accumulated token usage. */
export function geminiChatUsd(u: GeminiUsage): number {
  return (
    (u.inputTokens * PRICE.gemini_in) +
    (u.outputTokens * PRICE.gemini_out) +
    (u.cachedTokens * PRICE.gemini_cached)
  ) / 1_000_000;
}

/** USD for embedding `tokens` input tokens (estimated from text length upstream). */
export function geminiEmbedUsd(tokens: number): number {
  return (Math.max(0, tokens) * PRICE.embed_in) / 1_000_000;
}

/** USD for synthesizing `chars` characters of speech. */
export function ttsUsd(chars: number): number {
  return (Math.max(0, chars) * PRICE.tts_chars) / 1_000_000;
}

/** Rough token estimate for text where the provider doesn't return a count
 *  (embeddings): ~4 chars/token. Good enough for calibration; units are stored. */
export function estimateTokens(text: string): number {
  return Math.ceil((text?.length ?? 0) / 4);
}

/**
 * Record one metered call: write the raw usage_event AND debit the wallet, via the
 * atomic meter_record RPC. FAIL-OPEN — swallows every error so the caller (the bot)
 * is never affected. Skips the DB round-trip entirely when cost is zero but still
 * records the event for observability.
 */
export async function recordUsage(
  ctx: MeterCtx,
  provider: string,
  model: string,
  units: Record<string, unknown>,
  costUsd: number,
): Promise<void> {
  try {
    const credits = creditsForCost(costUsd);
    const { data } = await ctx.svc.rpc("meter_record", {
      p_store_id: ctx.storeId,
      p_kind: ctx.kind,
      p_provider: provider,
      p_model: model,
      p_units: units,
      p_cost_usd: Number(costUsd.toFixed(6)),
      p_credits: credits,
      p_ref: ctx.ref ?? null,
    });
    // meter_record returns { remaining, threshold, crossed } — or null for an
    // assistant not yet attached to a company (recorded, not billed).
    const res = data as MeterResult | null;
    if (res?.crossed) {
      // Off the critical path: the customer is waiting on a reply, and SMTP is
      // slow. waitUntil keeps the send alive after the response is returned.
      background(notifyThresholdCrossed(ctx.svc, ctx.storeId, res.remaining ?? 0, res.threshold ?? 0));
    }
  } catch (e) {
    console.warn(`[meter] record failed (non-fatal): ${(e as Error)?.message ?? e}`);
  }
}

interface MeterResult {
  remaining?: number;
  threshold?: number;
  crossed?: boolean;
}

/** Run work after the response is sent. Supabase's runtime exposes waitUntil;
 *  without it, a detached promise is still better than blocking the reply. */
function background(p: Promise<unknown>): void {
  const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  try {
    if (rt?.waitUntil) {
      rt.waitUntil(p);
      return;
    }
  } catch {
    /* fall through to detached */
  }
  p.catch(() => {});
}

/**
 * Warn the account that its credit balance just fell to/below its threshold.
 *
 * Fires ONCE per crossing — meter_record only reports `crossed` on the debit that
 * takes the balance from above the threshold to at or below it, and a grant that
 * lifts it back re-arms. So a company sitting under its threshold gets one email,
 * not one per conversation.
 *
 * Recipients are the account's own billing address or its owners/admins, resolved
 * server-side by company_alert_target. Best-effort throughout: this is a courtesy,
 * and nothing here may ever surface to a customer mid-chat.
 */
async function notifyThresholdCrossed(
  svc: SupabaseClient,
  storeId: string,
  remaining: number,
  threshold: number,
): Promise<void> {
  try {
    const { data } = await svc.rpc("company_alert_target", { p_store_id: storeId });
    const target = data as { company_name?: string; emails?: string[] } | null;
    const emails = (target?.emails ?? []).filter((e) => typeof e === "string" && e.includes("@"));
    if (!emails.length) return;

    const name = target?.company_name || "your account";
    const subject = `Credits running low — ${name}`;
    const body =
      `${name} has ${remaining.toLocaleString()} credits left, which is at or below ` +
      `the ${threshold.toLocaleString()}-credit warning level set on the account.\n\n` +
      `Your assistant is still running and will keep answering — nothing has been ` +
      `switched off. This is a heads-up so you can top up before it becomes urgent.\n\n` +
      `You can see usage and adjust the warning level under Credits in your console.`;

    for (const to of emails) await sendEmail(to, subject, body, name);
  } catch (e) {
    console.warn(`[meter] threshold notify failed (non-fatal): ${(e as Error)?.message ?? e}`);
  }
}

/**
 * Grace-then-stop credit gate, with a SAFE per-store rollout.
 *   CREDITS_ENFORCED unset/other  → nobody enforced (master switch off).
 *   CREDITS_ENFORCED=true         → enforce ONLY stores that opted in
 *                                   (agent_config 'credits_enforced' = 'true').
 *   CREDITS_ENFORCED=all          → enforce every store.
 * When a store is enforced, the bot keeps answering until the balance falls below
 * -CREDITS_GRACE, then stops. FAIL-OPEN on any error or missing wallet — a billing
 * read must never break a live bot.
 */
export async function creditGateOpen(svc: SupabaseClient, storeId: string): Promise<boolean> {
  const mode = (Deno.env.get("CREDITS_ENFORCED") ?? "").toLowerCase();
  if (mode !== "true" && mode !== "all") return true; // master switch off
  const grace = numEnv("CREDITS_GRACE", 500);
  try {
    // "true" = per-store opt-in (safe rollout); "all" = every store.
    if (mode === "true") {
      const { data: cfg } = await svc
        .from("agent_config")
        .select("value")
        .eq("store_id", storeId)
        .eq("key", "credits_enforced")
        .maybeSingle();
      if (String(cfg?.value ?? "").toLowerCase() !== "true") return true; // store not enrolled
    }
    // Company pool, not the retired per-store wallet (see migration 0111).
    const { data: s } = await svc
      .from("stores")
      .select("company_id")
      .eq("id", storeId)
      .maybeSingle();
    const companyId = (s as { company_id?: string } | null)?.company_id;
    if (!companyId) return true; // assistant not on an account → never block

    const { data } = await svc
      .from("company_wallet")
      .select("granted_credits, spent_credits")
      .eq("company_id", companyId)
      .maybeSingle();
    if (!data) return true; // no wallet row → never block
    // NB: the balance can go negative (record-only overrun) — don't clamp with num().
    const balance = (Number(data.granted_credits) || 0) - (Number(data.spent_credits) || 0);
    return balance > -grace;
  } catch {
    return true; // fail-open
  }
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
function numEnv(name: string, dflt: number): number {
  const v = parseFloat(Deno.env.get(name) ?? "");
  return Number.isFinite(v) && v >= 0 ? v : dflt;
}
