// sharepoint-sync — a SharePoint folder as a knowledge source.
//
// The owner pastes the folder link they already have in their browser. We walk
// it, read the files, and put each through exactly the same extraction, chunking
// and embedding path as a hand-uploaded document. Answers then come from the
// policy text itself, and a re-sync makes the answer follow the document.
//
// Work is PLANNED, then done in batches. Extraction of a scanned PDF is a model
// call; thirty in series is minutes of wall clock against a function that does
// not get minutes. Planning writes a row per file, each pass finishes a few, and
// an interrupted sync resumes instead of restarting — which also means progress
// is a fact in a table rather than a spinner that lies.
//
// Four things are deliberate:
//
//   • It reads with a PERSON'S delegated access, never a service identity.
//     Files.Read.All means "everything the signed-in user can reach", so whoever
//     connects the folder sets the blast radius, and that is recorded.
//   • Office files come down through Graph's own ?format=pdf conversion. The
//     extractor reads PDF, text and spreadsheets but not .docx — which is
//     exactly what a policy is. Converting at the source beats maintaining a
//     second document parser.
//   • Titles are settled at plan time and disambiguated, because ingestion
//     replaces by title: two folders each holding "Policy.docx" would otherwise
//     silently overwrite one another.
//   • Files that have gone from the folder are retired from the index. A policy
//     withdrawn in SharePoint but still answering questions here is the worst
//     thing this can do, and it would be silent.
//
// Called with the service key from the console's own server actions.

import { serviceClient } from "../_shared/supabase.ts";
import { getStoreById } from "../_shared/config.ts";
import { getAccessToken } from "../_shared/connections.ts";
import { requireBundle } from "../_shared/graph.ts";
import { extractFileText } from "../_shared/extract.ts";
import { ingestDocument, reindexKnowledge } from "../_shared/knowledge.ts";

const GRAPH = "https://graph.microsoft.com/v1.0";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

/** Files finished per pass. Small because the slowest step is a model call on a
 *  scanned PDF, and the caller simply asks again while anything is left. */
const BATCH = 4;
/** Sub-folder depth. Deep enough for how document libraries are really arranged,
 *  shallow enough that a link to the root of a whole site cannot walk forever. */
const MAX_DEPTH = 4;
const MAX_FILES = 400;
const MAX_BYTES = 20 * 1024 * 1024;

const CONVERTIBLE = /\.(docx?|pptx?|odt|odp|rtf)$/i;
const DIRECT = /\.(pdf|txt|md|markdown|csv|tsv|html?|json|xlsx?)$/i;

// deno-lint-ignore no-explicit-any
type Any = any;

/**
 * Turn a pasted SharePoint or OneDrive link into the item it points at.
 *
 * Graph takes a sharing URL base64url-encoded with a "u!" prefix. It is the only
 * addressing form that works from what a person can actually copy — the
 * alternative needs a site id, a drive id and a server-relative path, none of
 * which appear in the browser.
 */
async function resolveShare(token: string, url: string): Promise<Any | null> {
  const b64 = btoa(url).replace(/=+$/, "").replace(/\//g, "_").replace(/\+/g, "-");
  const res = await fetch(`${GRAPH}/shares/u!${b64}/driveItem`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
  });
  if (!res.ok) return null;
  return await res.json();
}

async function children(token: string, driveId: string, itemId: string): Promise<Any[]> {
  const out: Any[] = [];
  let next = `${GRAPH}/drives/${driveId}/items/${itemId}/children` +
    `?$top=200&$select=id,name,size,file,folder,eTag,lastModifiedDateTime`;
  while (next) {
    const res = await fetch(next, { headers: { authorization: `Bearer ${token}`, accept: "application/json" } });
    if (!res.ok) break;
    const page = await res.json();
    out.push(...((page.value as Any[]) ?? []));
    next = page["@odata.nextLink"] ?? "";
  }
  return out;
}

type Found = { id: string; name: string; relPath: string; size: number; etag: string | null };

/** Walk the folder, including sub-folders, collecting readable files. */
async function walk(
  token: string, driveId: string, itemId: string, prefix: string, depth: number, recurse: boolean,
  acc: Found[], skipped: string[],
): Promise<void> {
  if (acc.length >= MAX_FILES) return;
  for (const k of await children(token, driveId, itemId)) {
    if (acc.length >= MAX_FILES) return;
    const name = String(k.name ?? "");
    if (k.folder) {
      if (recurse && depth < MAX_DEPTH) {
        await walk(token, driveId, k.id, `${prefix}${name}/`, depth + 1, recurse, acc, skipped);
      }
      continue;
    }
    if (!k.file) continue;
    if (!CONVERTIBLE.test(name) && !DIRECT.test(name)) { skipped.push(name); continue; }
    acc.push({
      id: String(k.id),
      name,
      relPath: `${prefix}${name}`,
      size: Number(k.size ?? 0),
      etag: (k.eTag as string | null) ?? null,
    });
  }
}

async function download(
  token: string, driveId: string, itemId: string, convert: boolean,
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const url = `${GRAPH}/drives/${driveId}/items/${itemId}/content${convert ? "?format=pdf" : ""}`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > MAX_BYTES) return null;
  const mime = convert ? "application/pdf" : (res.headers.get("content-type") ?? "").split(";")[0];
  return { bytes: buf, mime: mime || "application/octet-stream" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const db = serviceClient();
  let body: Any;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }

  const storeId = String(body.store_id ?? "");
  const action = String(body.action ?? "run");
  const store = storeId ? await getStoreById(db, storeId) : null;
  if (!store) return json({ error: "unknown store" }, 404);

  const who = String(body.connected_by ?? "").trim().toLowerCase();
  const token = await getAccessToken(db, store.id, "microsoft", who);
  if (!token) {
    return json({
      error: who
        ? `${who} hasn't connected Microsoft 365 yet, so there's no access to read that folder with.`
        : "Microsoft 365 isn't connected for this assistant.",
      needs_connection: true,
    }, 400);
  }

  // Reading SharePoint needs Files.Read.All and Sites.Read.All. Checking up front
  // turns a wall of 403s partway through a sync into one sentence and a link.
  const allowed = await requireBundle(db, store.id, "documents", who);
  if (!allowed.ok) {
    const offer = allowed.offer as Any;
    return json({
      error: "This account can read documents only after an administrator approves it, once.",
      approve_url: offer?.approve_url ?? null,
      needs_consent: true,
    }, 400);
  }

  // ── preview ───────────────────────────────────────────────────────────────
  if (action === "preview") {
    const item = await resolveShare(token, String(body.folder_url ?? ""));
    if (!item) return json({ error: "That link couldn't be opened. Check it's a folder this account can reach." }, 400);
    if (!item.folder) return json({ error: "That link points at a file. Paste the link to the folder that holds your documents." }, 400);
    const driveId = item.parentReference?.driveId;
    if (!driveId) return json({ error: "Couldn't work out which document library that folder is in." }, 400);

    const found: Found[] = [];
    const skipped: string[] = [];
    await walk(token, driveId, item.id, "", 0, body.include_subfolders !== false, found, skipped);
    return json({
      ok: true,
      label: item.name,
      drive_id: driveId,
      item_id: item.id,
      files: found.map((f) => ({ name: f.relPath, size: f.size })),
      skipped,
      truncated: found.length >= MAX_FILES,
    });
  }

  // ── everything below works against a saved source ─────────────────────────
  const { data: srcRow } = await db
    .from("sharepoint_source").select("*").eq("id", String(body.source_id ?? "")).eq("store_id", store.id).maybeSingle();
  const src = srcRow as Any;
  if (!src) return json({ error: "unknown source" }, 404);

  let driveId = src.drive_id as string | null;
  let itemId = src.item_id as string | null;
  if (!driveId || !itemId) {
    const item = await resolveShare(token, src.folder_url);
    if (!item?.folder) return json({ error: "That folder couldn't be opened." }, 400);
    driveId = item.parentReference?.driveId ?? null;
    itemId = String(item.id);
    if (!driveId) return json({ error: "Couldn't work out which document library that folder is in." }, 400);
    await db.from("sharepoint_source").update({ drive_id: driveId, item_id: itemId, label: item.name }).eq("id", src.id);
  }

  // ── plan: walk the folder and write a row per file ────────────────────────
  if (action === "plan" || (action === "run" && src.sync_state !== "working")) {
    const found: Found[] = [];
    const skipped: string[] = [];
    await walk(token, driveId, itemId!, "", 0, src.include_subfolders !== false, found, skipped);

    // Titles are settled here. Ingestion replaces by title, so a title already
    // owned by ANOTHER source has to be made distinct or syncing this folder
    // would erase that folder's document with no warning.
    const { data: taken } = await db
      .from("sharepoint_file").select("title, source_id").eq("store_id", store.id).neq("source_id", src.id);
    const owned = new Set(((taken ?? []) as Any[]).map((r) => String(r.title)));
    const label = String(src.label ?? "SharePoint");

    const rows = found.map((f) => {
      let title = f.relPath;
      if (owned.has(title)) title = `${label}/${f.relPath}`;
      return {
        source_id: src.id, store_id: store.id, item_id: f.id,
        rel_path: f.relPath, title, size: f.size, etag: f.etag,
        status: "pending", note: null,
      };
    });

    // Rows that already exist keep their status unless the file changed, so a
    // re-sync of forty unchanged documents costs one listing call.
    const { data: existing } = await db
      .from("sharepoint_file").select("item_id, etag, status").eq("source_id", src.id);
    const prior = new Map(((existing ?? []) as Any[]).map((r) => [String(r.item_id), r]));
    const toWrite = rows.map((r) => {
      const p = prior.get(r.item_id);
      if (p && p.etag && p.etag === r.etag && p.status === "done") return { ...r, status: "done" };
      return r;
    });

    if (toWrite.length > 0) {
      await db.from("sharepoint_file").upsert(toWrite, { onConflict: "source_id,item_id" });
    }
    // Files no longer in the folder: drop their rows and retire their documents.
    const live = new Set(found.map((f) => f.id));
    const goneRows = ((existing ?? []) as Any[]).filter((r) => !live.has(String(r.item_id)));
    if (goneRows.length > 0) {
      const { data: goneTitles } = await db
        .from("sharepoint_file").select("title").eq("source_id", src.id)
        .in("item_id", goneRows.map((r) => String(r.item_id)));
      const titles = ((goneTitles ?? []) as Any[]).map((r) => String(r.title));
      if (titles.length > 0) {
        await db.from("knowledge_index").delete()
          .eq("store_id", store.id).eq("sharepoint_source_id", src.id).in("source_ref", titles);
      }
      await db.from("sharepoint_file").delete()
        .eq("source_id", src.id).in("item_id", goneRows.map((r) => String(r.item_id)));
    }

    await db.from("sharepoint_source").update({
      sync_state: "working",
      planned_at: new Date().toISOString(),
      last_result: `${found.length} file${found.length === 1 ? "" : "s"} found${skipped.length ? `, ${skipped.length} unsupported` : ""}`,
    }).eq("id", src.id);

    if (action === "plan") {
      const { count } = await db.from("sharepoint_file")
        .select("id", { count: "exact", head: true }).eq("source_id", src.id).eq("status", "pending");
      return json({ ok: true, planned: found.length, pending: count ?? 0, skipped, truncated: found.length >= MAX_FILES });
    }
  }

  // ── work: finish a few pending files ──────────────────────────────────────
  const { data: batch } = await db
    .from("sharepoint_file").select("*").eq("source_id", src.id).eq("status", "pending").limit(BATCH);

  let indexed = 0;
  for (const f of ((batch ?? []) as Any[])) {
    const name = String(f.rel_path);
    const convert = CONVERTIBLE.test(name);
    try {
      const got = await download(token, driveId, String(f.item_id), convert);
      if (!got) {
        await db.from("sharepoint_file").update({ status: "error", note: "couldn't be downloaded" }).eq("id", f.id);
        continue;
      }
      const safe = name.replace(/[^a-zA-Z0-9._/-]/g, "_").replace(/\//g, "__");
      const path = `${store.slug}/sharepoint/${f.item_id}${convert ? ".pdf" : ""}-${safe}`;
      await db.storage.from("kb").upload(path, got.bytes, { contentType: got.mime, upsert: true });

      const text = await extractFileText(got.bytes, got.mime, name);
      if (!text.trim()) {
        await db.from("sharepoint_file").update({ status: "skipped", note: "no readable text" }).eq("id", f.id);
        continue;
      }
      await ingestDocument(db, store.id, String(f.title), text, path, got.mime);
      await db.from("knowledge_index").update({ sharepoint_source_id: src.id })
        .eq("store_id", store.id).eq("kind", "document_chunk").eq("source_ref", String(f.title));
      await db.from("sharepoint_file")
        .update({ status: "done", note: null, indexed_at: new Date().toISOString() }).eq("id", f.id);
      indexed++;
    } catch (e) {
      await db.from("sharepoint_file")
        .update({ status: "error", note: (e instanceof Error ? e.message : String(e)).slice(0, 300) }).eq("id", f.id);
    }
  }

  const { count: pending } = await db.from("sharepoint_file")
    .select("id", { count: "exact", head: true }).eq("source_id", src.id).eq("status", "pending");
  const left = pending ?? 0;

  // Embedding is its own drain, and only worth running once the files are in.
  let embedRemaining = 0;
  if (left === 0) {
    const r = await reindexKnowledge(db, store.id, 400);
    embedRemaining = r.remaining;
  }

  if (left === 0 && embedRemaining === 0) {
    const [{ count: done }, { count: bad }, { count: skip }] = await Promise.all([
      db.from("sharepoint_file").select("id", { count: "exact", head: true }).eq("source_id", src.id).eq("status", "done"),
      db.from("sharepoint_file").select("id", { count: "exact", head: true }).eq("source_id", src.id).eq("status", "error"),
      db.from("sharepoint_file").select("id", { count: "exact", head: true }).eq("source_id", src.id).eq("status", "skipped"),
    ]);
    const summary = [
      `${done ?? 0} document${(done ?? 0) === 1 ? "" : "s"} indexed`,
      (skip ?? 0) > 0 ? `${skip} had no readable text` : "",
      (bad ?? 0) > 0 ? `${bad} failed` : "",
    ].filter(Boolean).join(", ");
    await db.from("sharepoint_source").update({
      sync_state: "idle",
      last_synced_at: new Date().toISOString(),
      last_result: summary,
      file_count: done ?? 0,
    }).eq("id", src.id);
    return json({ ok: true, done: true, indexed, pending: 0, summary });
  }

  return json({ ok: true, done: false, indexed, pending: left, embedding_remaining: embedRemaining });
});
