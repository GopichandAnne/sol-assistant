"use server";

import { revalidatePath } from "next/cache";
import { getActiveStore } from "@/lib/store/active-store";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { untyped } from "@/lib/supabase/untyped";

export type SharePointSource = {
  id: string;
  folderUrl: string;
  label: string | null;
  connectedBy: string;
  lastSyncedAt: string | null;
  lastResult: string | null;
  fileCount: number;
  syncState: string;
};

export type PreviewResult =
  | { ok: true; label: string; files: { name: string; size: number }[]; skipped: string[]; truncated: boolean }
  | { ok: false; error: string; approveUrl?: string | null; needsConnection?: boolean };

/** One pass of a sync. `done` false means call again — the work is batched so a
 *  folder of scanned PDFs cannot run a single request out of wall clock. */
export type SyncStep =
  | { ok: true; done: boolean; indexed: number; pending: number; summary?: string }
  | { ok: false; error: string; approveUrl?: string | null };

async function requireOwner() {
  const ctx = await getActiveStore();
  if (!ctx?.active) throw new Error("No active store.");
  const supabase = await createClient();
  const { data: isOwner } = await supabase.rpc("user_is_owner", { p_store_id: ctx.active.id });
  if (!isOwner) throw new Error("Owners only.");
  return ctx.active;
}

/** Reach the sync function with the service key, as knowledge indexing already
 *  reaches bot-admin. The Microsoft token never leaves Supabase. */
async function callSync(
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string; approveUrl?: string | null; needsConnection?: boolean }> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !serviceKey) return { ok: false, error: "Supabase isn't configured for this deployment." };
  try {
    const res = await fetch(`${base}/functions/v1/sharepoint-sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        error: String(data?.error ?? `That didn't work (${res.status}).`),
        approveUrl: (data?.approve_url as string | null) ?? null,
        needsConnection: !!data?.needs_connection,
      };
    }
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function listSharePointSources(): Promise<SharePointSource[]> {
  const store = await requireOwner();
  const from = untyped(createAdminClient());
  const { data } = await from("sharepoint_source")
    .select("id, folder_url, label, connected_by, last_synced_at, last_result, file_count, sync_state")
    .eq("store_id", store.id)
    .order("created_at", { ascending: false });
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    folderUrl: String(r.folder_url),
    label: (r.label as string | null) ?? null,
    connectedBy: String(r.connected_by ?? ""),
    lastSyncedAt: (r.last_synced_at as string | null) ?? null,
    lastResult: (r.last_result as string | null) ?? null,
    fileCount: Number(r.file_count ?? 0),
    syncState: String(r.sync_state ?? "idle"),
  }));
}

/** Which people have connected Microsoft 365, so the panel can offer a choice
 *  instead of asking someone to remember an address and get it wrong. */
export async function listMicrosoftConnections(): Promise<{ userKey: string; label: string }[]> {
  const store = await requireOwner();
  const from = untyped(createAdminClient());
  const { data } = await from("oauth_connection")
    .select("user_key, account_label")
    .eq("store_id", store.id)
    .eq("provider", "microsoft")
    .eq("status", "connected");
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    userKey: String(r.user_key ?? ""),
    label: String(r.account_label ?? r.user_key ?? "this assistant's connection"),
  }));
}

/**
 * Resolve the pasted link and report what is in it, reading nothing.
 *
 * Files.Read.All reaches everything the connecting person can reach, so the one
 * thing an owner must see before indexing starts is the actual list of files
 * about to be read. That is what stops a folder which turned out to hold
 * compensation bands becoming answerable by everyone who can chat.
 */
export async function previewSharePointFolder(
  folderUrl: string,
  connectedBy: string,
  includeSubfolders = true,
): Promise<PreviewResult> {
  const store = await requireOwner();
  const url = folderUrl.trim();
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: "Paste the folder link from your browser." };
  const res = await callSync({
    action: "preview",
    store_id: store.id,
    folder_url: url,
    connected_by: connectedBy.trim().toLowerCase(),
    include_subfolders: includeSubfolders,
  });
  if (!res.ok) {
    return { ok: false, error: res.error ?? "Couldn't open that folder.", approveUrl: res.approveUrl, needsConnection: res.needsConnection };
  }
  const d = res.data ?? {};
  return {
    ok: true,
    label: String(d.label ?? "Folder"),
    files: (d.files as { name: string; size: number }[] | undefined) ?? [],
    skipped: (d.skipped as string[] | undefined) ?? [],
    truncated: !!d.truncated,
  };
}

export async function addSharePointSource(
  folderUrl: string,
  connectedBy: string,
  includeSubfolders = true,
): Promise<{ ok: boolean; error?: string; id?: string }> {
  const store = await requireOwner();
  const url = folderUrl.trim();
  const who = connectedBy.trim().toLowerCase();
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: "Paste the folder link from your browser." };
  if (who && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(who)) {
    return { ok: false, error: "That doesn't look like an email address." };
  }
  const from = untyped(createAdminClient());
  const { data, error } = await from("sharepoint_source")
    .insert({ store_id: store.id, folder_url: url, connected_by: who, include_subfolders: includeSubfolders })
    .select("id")
    .maybeSingle();
  if (error) {
    if (error.code === "23505") return { ok: false, error: "That folder is already connected." };
    return { ok: false, error: error.message };
  }
  revalidatePath("/knowledge");
  return { ok: true, id: String((data as { id: string }).id) };
}

/**
 * One pass of a sync. The caller keeps calling while `done` is false.
 *
 * Driven from the browser rather than a queue because it gives the person who
 * pressed the button a real count as it goes, and because a sync they can watch
 * is a sync they will not press twice.
 */
export async function syncSharePointStep(id: string): Promise<SyncStep> {
  const store = await requireOwner();
  const from = untyped(createAdminClient());
  const { data } = await from("sharepoint_source")
    .select("connected_by").eq("id", id).eq("store_id", store.id).maybeSingle();
  const who = String((data as { connected_by?: string } | null)?.connected_by ?? "");

  const res = await callSync({ action: "run", store_id: store.id, source_id: id, connected_by: who });
  if (!res.ok) return { ok: false, error: res.error ?? "Sync failed.", approveUrl: res.approveUrl };
  const d = res.data ?? {};
  if (d.done) revalidatePath("/knowledge");
  return {
    ok: true,
    done: !!d.done,
    indexed: Number(d.indexed ?? 0),
    pending: Number(d.pending ?? 0),
    summary: d.summary ? String(d.summary) : undefined,
  };
}

/** Re-plan before syncing, so files added or removed in SharePoint are picked up. */
export async function replanSharePointSource(id: string): Promise<{ ok: boolean; error?: string; pending?: number }> {
  const store = await requireOwner();
  const from = untyped(createAdminClient());
  const { data } = await from("sharepoint_source")
    .select("connected_by").eq("id", id).eq("store_id", store.id).maybeSingle();
  const who = String((data as { connected_by?: string } | null)?.connected_by ?? "");
  const res = await callSync({ action: "plan", store_id: store.id, source_id: id, connected_by: who });
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, pending: Number(res.data?.pending ?? 0) };
}

/** Removing the connection leaves its documents indexed on purpose: they are
 *  answers the assistant is currently giving, and deleting them as a side effect
 *  of tidying up a connection would be a surprise. Remove them from Documents. */
export async function removeSharePointSource(id: string): Promise<{ ok: boolean; error?: string }> {
  const store = await requireOwner();
  const from = untyped(createAdminClient());
  const { error } = await from("sharepoint_source").delete().eq("id", id).eq("store_id", store.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/knowledge");
  return { ok: true };
}
