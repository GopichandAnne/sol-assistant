// sharepoint-sync — a SharePoint folder as a knowledge source.
//
// The owner pastes the folder link they already have in their browser. We
// resolve it, read the files in it, and put them through exactly the same
// extraction, chunking and embedding path as a hand-uploaded document. Answers
// then cite the real file, and a re-sync makes the answer follow the document.
//
// Four things are deliberate:
//
//   • It reads with a PERSON'S delegated access, never a service identity.
//     Files.Read.All means "everything the signed-in user can reach", so the
//     person who connects the folder sets the blast radius — and that is
//     recorded, so it can be answered later and revoked.
//   • Office files are downloaded via Graph's own ?format=pdf conversion. The
//     extractor reads PDF, text and spreadsheets but not .docx — which is
//     exactly what an HR policy is. Converting at the source beats adding a
//     second document parser we would then have to keep correct.
//   • A document's title is its filename, and ingestion replaces by title, so
//     syncing twice updates rather than duplicates.
//   • Files that vanish from the folder are retired from the index. A policy
//     withdrawn in SharePoint but still answering questions here is the worst
//     failure this feature can have, and it is silent.
//
// Owner-authed (verify_jwt ON).

import { serviceClient } from "../_shared/supabase.ts";
import { getStoreById } from "../_shared/config.ts";
import { getAccessToken } from "../_shared/connections.ts";
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

/** Per run. A document library can hold thousands of files; a knowledge base
 *  that answers well holds the handful that are actually policy. */
const MAX_FILES = 60;
const MAX_BYTES = 20 * 1024 * 1024;

/** Formats Graph will convert to PDF for us, so the extractor can read them. */
const CONVERTIBLE = /\.(docx?|pptx?|odt|odp|rtf)$/i;
/** Formats the extractor already handles as downloaded. */
const DIRECT = /\.(pdf|txt|md|markdown|csv|tsv|html?|json|xlsx?)$/i;

// deno-lint-ignore no-explicit-any
type Any = any;

/**
 * Turn a pasted SharePoint or OneDrive link into the item it points at.
 *
 * Graph takes a sharing URL base64url-encoded with a "u!" prefix. This is the
 * only addressing form that works from what a person can actually copy — the
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

async function listChildren(token: string, driveId: string, itemId: string): Promise<Any[]> {
  const out: Any[] = [];
  let next = `${GRAPH}/drives/${driveId}/items/${itemId}/children?$top=200&$select=id,name,size,file,folder,lastModifiedDateTime,webUrl`;
  while (next && out.length < MAX_FILES) {
    const res = await fetch(next, { headers: { authorization: `Bearer ${token}`, accept: "application/json" } });
    if (!res.ok) break;
    const page = await res.json();
    out.push(...((page.value as Any[]) ?? []));
    next = page["@odata.nextLink"] ?? "";
  }
  return out;
}

/** Download one file, converting Office formats to PDF on the way out. */
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
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }

  const storeId = String(body.store_id ?? "");
  const action = String(body.action ?? "sync");
  const store = storeId ? await getStoreById(db, storeId) : null;
  if (!store) return json({ error: "unknown store" }, 404);

  // Whose access. Falls back to the organisation connection only when no person
  // is named, which is the service-account setup an owner chooses knowingly.
  const who = String(body.connected_by ?? "").trim().toLowerCase();
  const token = await getAccessToken(db, store.id, "microsoft", who);
  if (!token) {
    return json({
      error: who
        ? `${who} hasn't connected Microsoft 365, so there is no access to read that folder with.`
        : "Microsoft 365 isn't connected for this assistant.",
    }, 400);
  }

  // ── preview: resolve the link and say what is in it, before anything is read ──
  if (action === "preview") {
    const item = await resolveShare(token, String(body.folder_url ?? ""));
    if (!item) return json({ error: "That link couldn't be opened. Check it's a folder you can reach." }, 400);
    if (!item.folder) return json({ error: "That link points at a file. Paste the link to the folder holding your documents." }, 400);
    const driveId = item.parentReference?.driveId;
    if (!driveId) return json({ error: "Couldn't work out which document library that folder is in." }, 400);
    const kids = await listChildren(token, driveId, item.id);
    const files = kids.filter((k) => k.file).map((k) => ({
      name: k.name,
      size: k.size,
      readable: CONVERTIBLE.test(k.name) || DIRECT.test(k.name),
    }));
    return json({
      ok: true,
      label: item.name,
      drive_id: driveId,
      item_id: item.id,
      folders: kids.filter((k) => k.folder).length,
      files,
    });
  }

  // ── sync ──────────────────────────────────────────────────────────────────
  const sourceId = String(body.source_id ?? "");
  const { data: srcRow } = await db
    .from("sharepoint_source").select("*").eq("id", sourceId).eq("store_id", store.id).maybeSingle();
  const src = srcRow as Any;
  if (!src) return json({ error: "unknown source" }, 404);

  let driveId = src.drive_id as string | null;
  let itemId = src.item_id as string | null;
  if (!driveId || !itemId) {
    const item = await resolveShare(token, src.folder_url);
    if (!item?.folder) return json({ error: "That folder couldn't be opened." }, 400);
    driveId = item.parentReference?.driveId ?? null;
    itemId = item.id;
    if (!driveId) return json({ error: "Couldn't work out which document library that folder is in." }, 400);
    await db.from("sharepoint_source").update({ drive_id: driveId, item_id: itemId, label: item.name }).eq("id", src.id);
  }

  const kids = (await listChildren(token, driveId, itemId!)).filter((k) => k.file);
  const seen: string[] = [];
  let indexed = 0;
  let skipped = 0;
  const problems: string[] = [];

  for (const f of kids.slice(0, MAX_FILES)) {
    const name = String(f.name ?? "");
    const convert = CONVERTIBLE.test(name);
    if (!convert && !DIRECT.test(name)) { skipped++; continue; }

    try {
      const got = await download(token, driveId, f.id, convert);
      if (!got) { problems.push(`${name}: couldn't be downloaded`); continue; }

      // Keep the original alongside the chunks, exactly as an upload does, so the
      // console can still offer the file a citation refers to.
      const path = `${store.slug}/sharepoint/${f.id}${convert ? ".pdf" : ""}-${name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      await db.storage.from("kb").upload(path, got.bytes, { contentType: got.mime, upsert: true });

      const text = await extractFileText(got.bytes, got.mime, name);
      if (!text.trim()) { problems.push(`${name}: no readable text`); continue; }

      // Title is the filename, and ingestion replaces by title — so syncing the
      // same folder again updates these documents instead of duplicating them.
      await ingestDocument(db, store.id, name, text, path, got.mime);
      await db.from("knowledge_index")
        .update({ sharepoint_source_id: src.id })
        .eq("store_id", store.id).eq("kind", "document_chunk").eq("source_ref", name);
      seen.push(name);
      indexed++;
    } catch (e) {
      problems.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Retire anything this source produced before that is no longer in the folder.
  // A policy withdrawn in SharePoint must stop answering questions here.
  let retired = 0;
  try {
    const { data: existing } = await db
      .from("knowledge_index")
      .select("source_ref")
      .eq("store_id", store.id)
      .eq("sharepoint_source_id", src.id);
    const gone = [...new Set(((existing ?? []) as Any[]).map((r) => r.source_ref as string))]
      .filter((t) => t && !seen.includes(t));
    if (gone.length > 0) {
      await db.from("knowledge_index")
        .delete().eq("store_id", store.id).eq("sharepoint_source_id", src.id).in("source_ref", gone);
      retired = gone.length;
    }
  } catch (e) {
    console.error("[sharepoint-sync] retire:", e instanceof Error ? e.message : e);
  }

  const reindex = await reindexKnowledge(db, store.id, 500);

  const summary = [
    `${indexed} file${indexed === 1 ? "" : "s"} indexed`,
    retired > 0 ? `${retired} withdrawn` : "",
    skipped > 0 ? `${skipped} skipped (unsupported type)` : "",
    problems.length > 0 ? `${problems.length} had problems` : "",
  ].filter(Boolean).join(", ");

  await db.from("sharepoint_source").update({
    last_synced_at: new Date().toISOString(),
    last_result: summary,
    file_count: indexed,
  }).eq("id", src.id);

  return json({ ok: true, indexed, retired, skipped, problems, summary, ...reindex });
});
