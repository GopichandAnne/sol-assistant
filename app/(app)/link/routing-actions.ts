"use server";

import { Buffer } from "node:buffer";
import { revalidatePath } from "next/cache";
import { getActiveStore } from "@/lib/store/active-store";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Which assistant answers in which channel.
 *
 * The workspace default (set when the org connected) answers everywhere unless a
 * channel says otherwise, so this screen only ever adds overrides and an org that
 * wants one assistant never has to visit it.
 */

export type ChannelKind = "teams" | "slack";

export type SeenChannel = {
  channelId: string;
  name: string | null;
  lastSeen: string;
  /** The assistant currently answering here: a routed one, or the default. */
  routedStoreId: string | null;
};

export type RoutableAssistant = { id: string; name: string };

async function requireOwner(storeId: string) {
  const ctx = await getActiveStore();
  if (!ctx?.active || ctx.active.id !== storeId) throw new Error("No access to this assistant.");
  const supabase = await createClient();
  const { data: isOwner } = await supabase.rpc("user_is_owner", { p_store_id: storeId });
  if (!isOwner) throw new Error("Owners only.");
  return ctx;
}

/** Every assistant on the same account, since routing can only ever point at one
 *  of those. Falls back to just this assistant when it has no company yet. */
export async function listRoutableAssistants(storeId: string): Promise<RoutableAssistant[]> {
  await requireOwner(storeId);
  const db = createAdminClient();
  const { data: me } = await db.from("stores").select("company_id").eq("id", storeId).maybeSingle();
  const companyId = (me as { company_id?: string } | null)?.company_id;
  if (!companyId) {
    const { data } = await db.from("stores").select("id, slug, store_display_name").eq("id", storeId);
    return (data ?? []).map((s) => ({ id: s.id as string, name: (s.store_display_name as string) || (s.slug as string) }));
  }
  const { data } = await db
    .from("stores").select("id, slug, store_display_name")
    .eq("company_id", companyId).order("created_at");
  return (data ?? []).map((s) => ({ id: s.id as string, name: (s.store_display_name as string) || (s.slug as string) }));
}

/** Channels this workspace has actually used, with whatever is routed there now. */
export async function listSeenChannels(storeId: string, kind: ChannelKind, workspaceId: string): Promise<SeenChannel[]> {
  await requireOwner(storeId);
  if (!workspaceId) return [];
  const db = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const from = db.from as unknown as (t: string) => any;
  const [{ data: seen }, { data: routes }] = await Promise.all([
    from("channel_seen").select("channel_id, name, last_seen")
      .eq("channel_kind", kind).eq("workspace_id", workspaceId)
      .order("last_seen", { ascending: false }).limit(50),
    from("channel_route").select("channel_id, store_id")
      .eq("channel_kind", kind).eq("workspace_id", workspaceId),
  ]);
  const routed = new Map<string, string>();
  for (const r of (routes ?? []) as { channel_id: string; store_id: string }[]) routed.set(r.channel_id, r.store_id);
  return ((seen ?? []) as { channel_id: string; name: string | null; last_seen: string }[]).map((c) => ({
    channelId: c.channel_id,
    name: c.name,
    lastSeen: c.last_seen,
    routedStoreId: routed.get(c.channel_id) ?? null,
  }));
}

export type Result = { ok: true } | { ok: false; error: string };

/** Point a channel at an assistant, or clear it back to the workspace default. */
export async function routeChannel(
  storeId: string,
  kind: ChannelKind,
  workspaceId: string,
  channelId: string,
  targetStoreId: string | null,
): Promise<Result> {
  const ctx = await requireOwner(storeId);
  const db = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const from = db.from as unknown as (t: string) => any;

  if (!targetStoreId) {
    const { error } = await from("channel_route").delete()
      .eq("channel_kind", kind).eq("workspace_id", workspaceId).eq("channel_id", channelId);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/link");
    return { ok: true };
  }

  // Only ever point at an assistant on the same account. Without this check an
  // owner could route a channel to another company's assistant by id, which would
  // hand that company's knowledge to this workspace.
  const allowed = await listRoutableAssistants(storeId);
  if (!allowed.some((a) => a.id === targetStoreId) && !ctx.isPlatformAdmin) {
    return { ok: false, error: "That assistant isn't on this account." };
  }

  const { error } = await from("channel_route").upsert(
    { channel_kind: kind, workspace_id: workspaceId, channel_id: channelId, store_id: targetStoreId },
    { onConflict: "channel_kind,workspace_id,channel_id" },
  );
  if (error) return { ok: false, error: error.message };
  revalidatePath("/link");
  return { ok: true };
}

/**
 * The key a downstream API uses to verify identity assertions from this
 * assistant. Created on first read so nobody has to think about generating one,
 * and rotatable when it leaks.
 *
 * Owner-only, and deliberately readable rather than write-only: unlike a password,
 * the person integrating has to put this exact value into their own API, and a
 * key you cannot read is a key you cannot use.
 */
export async function getAssertionKey(storeId: string): Promise<{ key: string } | { error: string }> {
  await requireOwner(storeId);
  const db = createAdminClient();
  const { data } = await db.from("stores").select("assertion_secret").eq("id", storeId).maybeSingle();
  const existing = (data as { assertion_secret?: string | null } | null)?.assertion_secret;
  if (existing) return { key: existing };

  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const key = Buffer.from(bytes).toString("base64url");
  const { error } = await db.from("stores").update({ assertion_secret: key }).eq("id", storeId);
  if (error) return { error: error.message };
  return { key };
}

/** Replace the key. Anything already verifying with the old one stops working, so
 *  the console says that plainly before this runs. */
export async function rotateAssertionKey(storeId: string): Promise<{ key: string } | { error: string }> {
  await requireOwner(storeId);
  const db = createAdminClient();
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const key = Buffer.from(bytes).toString("base64url");
  const { error } = await db.from("stores").update({ assertion_secret: key }).eq("id", storeId);
  if (error) return { error: error.message };
  revalidatePath("/link");
  return { key };
}
