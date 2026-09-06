"use server";

import { getSessionContext } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type SavePhoneResult = { ok: true } | { ok: false; error: string };

/** E.164 normalize; null when invalid. */
function normalizeE164(raw: string): string | null {
  const t = (raw ?? "").trim();
  if (!t) return null;
  const digits = t.replace(/[^\d+]/g, "");
  const e164 = digits.startsWith("+") ? digits : `+${digits}`;
  return /^\+\d{7,15}$/.test(e164) ? e164 : null;
}

/**
 * Save the account phone. Lands the number on the AUTH identity (auth.users.phone)
 * via the admin API with phone_confirm — no SMS OTP round-trip — since that's the
 * number the WhatsApp↔console identity is matched on. Supabase enforces phone
 * uniqueness across accounts, so a number already claimed by another account can't
 * be set as the identity; we don't block on that — the phone_captured flag still
 * releases the gate, so the user is never locked out.
 */
export async function saveAccountPhone(phone: string): Promise<SavePhoneResult> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "You're not signed in." };

  const e164 = normalizeE164(phone);
  if (!e164) return { ok: false, error: "Enter a valid phone number with country code, e.g. +1 512 555 0142." };

  // Best-effort: set the auth identity phone (no SMS). Never throws the request.
  try {
    const admin = createAdminClient();
    await admin.auth.admin.updateUserById(ctx.user.id, { phone: e164, phone_confirm: true });
  } catch {
    /* already claimed by another account / non-fatal — captured flag below still clears the gate */
  }

  // Mark captured on the current user's metadata (merges) so the gate clears.
  try {
    const sb = await createClient();
    await sb.auth.updateUser({ data: { phone_captured: true } });
  } catch {
    /* non-fatal */
  }

  return { ok: true };
}
