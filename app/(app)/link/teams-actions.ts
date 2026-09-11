"use server";

import { getActiveStore } from "@/lib/store/active-store";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { untyped } from "@/lib/supabase/untyped";

export type PendingTenant = {
  tenantId: string;
  teamName: string | null;
  sampleUser: string | null;
  lastSeen: string;
  /** One-click admin-consent URL for THIS tenant. Application permissions on a
   *  multi-tenant app must be consented per organisation, so without this the bot
   *  can talk but cannot resolve anyone's email, and every user is anonymous. */
  consentUrl: string | null;
};

/**
 * The admin-consent URL to send an organisation's IT BEFORE anything is installed.
 *
 * The per-tenant form below needs a tenant id, which only arrives once someone has
 * installed the app and messaged the bot — so it could not be part of the pack you
 * send their IT in the first place, and consent became a second round-trip with the
 * same person. The /common form needs no id: the administrator signs in and consent
 * is granted for whichever directory they belong to.
 *
 * Module-private: this file is "use server", where every export must be an async
 * server action. It is read through getTeamsStatus like the rest.
 */
function commonConsentUrl(): string | null {
  const appId = process.env.MICROSOFT_APP_ID;
  if (!appId) return null;
  return `https://login.microsoftonline.com/common/adminconsent?client_id=${encodeURIComponent(appId)}`;
}

/** The per-tenant admin-consent URL. Formulaic, so the console builds it rather
 *  than sending someone to read Microsoft's docs. Preferred once the tenant is
 *  known, because it names the organisation being consented for. */
function consentUrlFor(tenantId: string): string | null {
  const appId = process.env.MICROSOFT_APP_ID;
  if (!appId || !tenantId) return null;
  return `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/adminconsent?client_id=${encodeURIComponent(appId)}`;
}

export type TeamsStatus = {
  configured: boolean;
  connected: boolean;
  tenantId?: string | null;
  approvalsEmail?: string | null;
  /** Consent URL for the CONNECTED tenant, so it can be re-sent if identity
   *  isn't resolving (the usual cause of everyone showing up anonymous). */
  consentUrl?: string | null;
  /** Tenant-agnostic consent URL, available before anything is installed, so the
   *  install instructions and the approval can go to their IT in one message. */
  setupConsentUrl?: string | null;
  /** Set when a directory lookup was refused for want of admin consent. The
   *  assistant still answers; it just cannot tell anyone apart, which is why this
   *  is worth saying out loud rather than leaving in a log. */
  consentMissing?: boolean;
  /** People who have messaged the bot, so we have a conversation to reach them on.
   *  Only these can receive approval cards. */
  reachable?: { email: string; name: string | null }[];
  /** Tenants that installed the app and messaged it, but aren't linked yet. The
   *  identifier arrives on its own, so nobody has to fetch it from Azure. */
  pending?: PendingTenant[];
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
  const from = untyped(db);
  const { data } = await from("teams_installs")
    .select("tenant_id, approvals_email, consent_missing_at").eq("store_id", storeId).eq("active", true).maybeSingle();
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
  // Anyone waiting to be linked. Only shown when this assistant isn't already
  // connected, so an established install doesn't nag about other orgs.
  let pending: PendingTenant[] = [];
  if (!data) {
    const { data: rows } = await from("teams_pending_tenant")
      .select("tenant_id, team_name, sample_user, last_seen")
      .order("last_seen", { ascending: false }).limit(10);
    pending = (rows ?? []).map((r: { tenant_id: string; team_name: string | null; sample_user: string | null; last_seen: string }) => ({
      tenantId: r.tenant_id, teamName: r.team_name, sampleUser: r.sample_user, lastSeen: r.last_seen,
      consentUrl: consentUrlFor(r.tenant_id),
    }));
  }

  return {
    configured,
    connected: !!data,
    tenantId: data?.tenant_id ?? null,
    approvalsEmail: data?.approvals_email ?? null,
    consentUrl: data?.tenant_id ? consentUrlFor(data.tenant_id) : null,
    setupConsentUrl: commonConsentUrl(),
    consentMissing: !!data?.consent_missing_at,
    reachable,
    pending,
  };
}

/** Map (or clear) an Azure AD tenant → this store, so Teams messages from that tenant
 *  route here. One bot serves many tenants; the tenant id is the org's directory id. */
export async function setTeamsTenant(storeId: string, tenantId: string): Promise<{ ok: boolean; error?: string }> {
  await requireOwner(storeId);
  const t = tenantId.trim();
  const db = createAdminClient();
  const from = untyped(db);
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
  const from = untyped(db);
  const { error } = await from("teams_installs")
    .update({ approvals_email: e || null }).eq("store_id", storeId).eq("active", true);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Link a waiting tenant to this assistant. The whole point of the pending queue:
 *  the owner never types a GUID, they confirm an org that already showed up. */
export async function linkPendingTenant(storeId: string, tenantId: string): Promise<{ ok: boolean; error?: string }> {
  await requireOwner(storeId);
  const t = tenantId.trim();
  if (!t) return { ok: false, error: "No tenant given." };
  const db = createAdminClient();
  const from = untyped(db);
  const { error } = await from("teams_installs")
    .upsert({ tenant_id: t, store_id: storeId, active: true }, { onConflict: "tenant_id" });
  if (error) return { ok: false, error: error.message };
  await from("teams_pending_tenant").delete().eq("tenant_id", t);
  return { ok: true };
}
