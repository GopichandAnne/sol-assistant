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
};

export type PreviewResult =
  | { ok: true; label: string; files: { name: string; size: number; readable: boolean }[]; folders: number }
  | { ok: false; error: string };

async function requireOwner() {
  const ctx = await getActiveStore();
  if (!ctx?.active) throw new Error("No active store.");
  const supabase = await createClient();
  const { data: isOwner } = await supabase.rpc("user_is_owner", { p_store_id: ctx.active.id });
  if (!isOwner) throw new Error("Owners only.");
  return ctx.active;
}

/** Call the sync function with the service key, the same way knowledge indexing
 *  already reaches bot-admin. The Microsoft token never leaves Supabase. */
async function callSync(payload: Record<string, unknown>): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !serviceKey) return { ok: false, error: "Supabase isn't configured for this deployment." };
  try {
    const res = await fetch(`${base}/functions/v1/sharepoint-sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: String(data?.error ?? `Sync failed (${res.status}).`) };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function listSharePointSources(): Promise<SharePointSource[]> {
  const store = await requireOwner();
  const from = untyped(createAdminClient());
  const { data } = await from("sharepoint_source")
    .select("id, folder_url, label, connected_by, last_synced_at, last_result, file_count")
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
  }));
}

/** Resolve the pasted link and report what is in it, WITHOUT reading anything.
 *  Seeing the file list before indexing is what stops somebody pointing this at
 *  a folder they did not realise contained payroll. */
export async function previewSharePointFolder(folderUrl: string, connectedBy: string): Promise<PreviewResult> {
  const store = await requireOwner();
  const url = folderUrl.trim();
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: "Paste the folder link from your browser." };
  const res = await callSync({
    action: "preview",
    store_id: store.id,
    folder_url: url,
    connected_by: connectedBy.trim().toLowerCase(),
  });
  if (!res.ok) return { ok: false, error: res.error ?? "Couldn't open that folder." };
  const d = res.data ?? {};
  return {
    ok: true,
    label: String(d.label ?? "Folder"),
    folders: Number(d.folders ?? 0),
    files: (d.files as { name: string; size: number; readable: boolean }[] | undefined) ?? [],
  };
}

export async function addSharePointSource(
  folderUrl: string,
  connectedBy: string,
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
    .insert({ store_id: store.id, folder_url: url, connected_by: who })
    .select("id")
    .maybeSingle();
  if (error) {
    if (error.code === "23505") return { ok: false, error: "That folder is already connected." };
    return { ok: false, error: error.message };
  }
  revalidatePath("/knowledge");
  return { ok: true, id: String((data as { id: string }).id) };
}

export async function syncSharePointSource(id: string): Promise<{ ok: boolean; error?: string; summary?: string }> {
  const store = await requireOwner();
  const res = await callSync({ action: "sync", store_id: store.id, source_id: id, connected_by: await connectedByFor(store.id, id) });
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath("/knowledge");
  return { ok: true, summary: String(res.data?.summary ?? "Synced.") };
}

async function connectedByFor(storeId: string, id: string): Promise<string> {
  const from = untyped(createAdminClient());
  const { data } = await from("sharepoint_source")
    .select("connected_by").eq("id", id).eq("store_id", storeId).maybeSingle();
  return String((data as { connected_by?: string } | null)?.connected_by ?? "");
}

/** Removing the source leaves its documents indexed on purpose: they are answers
 *  the assistant is currently giving, and deleting them as a side effect of
 *  tidying up a connection would be a surprise. Delete them from the list above. */
export async function removeSharePointSource(id: string): Promise<{ ok: boolean; error?: string }> {
  const store = await requireOwner();
  const from = untyped(createAdminClient());
  const { error } = await from("sharepoint_source").delete().eq("id", id).eq("store_id", store.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/knowledge");
  return { ok: true };
}
