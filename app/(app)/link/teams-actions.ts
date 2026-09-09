"use server";

import { getActiveStore } from "@/lib/store/active-store";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type TeamsStatus = {
  configured: boolean;
  connected: boolean;
  tenantId?: string | null;
  approvalsEmail?: string | null;
  /** People who have messaged the bot, so we have a conversation to reach them on.
   *  Only these can receive approval cards. */
  reachable?: { email: string; name: string | null }[];
};

async function requireOwner(storeId: string) {
  const ctx = await getActiveStore();
  if (!ctx?.active || ctx.active.id !== storeId) throw new Error("No access to this store.");
  const supabase = await createClient();
  const { data: isOwner } = await supabase.rpc("user_is_owner", { p_store_id: storeId });
  if (!isOwner) throw new Error("Owners only.");
}

export async function getTeamsStatus(storeId: string): Promise<TeamsStatus> {
  await requireOwner(storeId);
  const db = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const from = db.from as unknown as (t: string) => any;
  const { data } = await from("teams_installs")
    .select("tenant_id, approvals_email").eq("store_id", storeId).eq("active", true).maybeSingle();
  const configured = !!(process.env.MICROSOFT_APP_ID && process.env.MICROSOFT_APP_PASSWORD);

  // Only people the bot has already spoken to can be sent a card: Bot Framework
  // gives you a conversation to post into when they message you, and not before.
  let reachable: { email: string; name: string | null }[] = [];
  if (data?.tenant_id) {
    const { data: users } = await from("teams_user")
      .select("email, name").eq("tenant_id", data.tenant_id).not("email", "is", null)
      .order("last_seen", { ascending: false }).limit(50);
    reachable = (users ?? []).map((u: { email: string; name: string | null }) => ({ email: u.email, name: u.name }));
  }
  return {
    configured,
    connected: !!data,
    tenantId: data?.tenant_id ?? null,
    approvalsEmail: data?.approvals_email ?? null,
    reachable,
  };
}

/** Map (or clear) an Azure AD tenant → this store, so Teams messages from that tenant
 *  route here. One bot serves many tenants; the tenant id is the org's directory id. */
export async function setTeamsTenant(storeId: string, tenantId: string): Promise<{ ok: boolean; error?: string }> {
  await requireOwner(storeId);
  const t = tenantId.trim();
  const db = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const from = db.from as unknown as (t: string) => any;
  if (!t) {
    await from("teams_installs").update({ active: false }).eq("store_id", storeId);
    return { ok: true };
  }
  if (!/^[0-9a-fA-F-]{16,}$/.test(t)) return { ok: false, error: "That doesn't look like an Azure tenant id (a GUID)." };
  const { error } = await from("teams_installs").upsert({ tenant_id: t, store_id: storeId, active: true }, { onConflict: "tenant_id" });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Nominate who receives Approve / Decline cards in Teams. A person, not a channel:
 *  posting into the conversation where a held action was raised would let the
 *  requester approve their own action. Empty clears it, and the Activity page
 *  remains the source of truth either way. */
export async function setTeamsApprover(storeId: string, email: string): Promise<{ ok: boolean; error?: string }> {
  await requireOwner(storeId);
  const e = email.trim().toLowerCase();
  if (e && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) {
    return { ok: false, error: "That doesn't look like an email address." };
  }
  const db = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const from = db.from as unknown as (t: string) => any;
  const { error } = await from("teams_installs")
    .update({ approvals_email: e || null }).eq("store_id", storeId).eq("active", true);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
