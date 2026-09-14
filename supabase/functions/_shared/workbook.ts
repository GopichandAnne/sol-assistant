// Spreadsheets as systems of record.
//
// Knowledge answers questions; doing the job usually means reading or writing a
// record. In a real deployment that is an HRIS or a finance system. In a great
// many organisations — and in every demo where we have not been given a
// production credential — it is a spreadsheet on SharePoint, and treating that
// honestly is more useful than pretending otherwise.
//
// Workbooks are REGISTERED, not discovered. The assistant is told "the leave
// tracker is this table in this file", so a question about leave reads a known
// table with known columns. A model told to go and find a likely-looking
// spreadsheet will find one, guess what the columns mean, and answer
// confidently from last year's file.
//
// Reading is ordinary. Writing is an action in somebody's system and goes
// through the same hold-and-approve path as any other write — the executor in
// tools.ts marks it side-effecting, and a workbook has to be made writable by an
// owner one at a time.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Store } from "./types.ts";
import { getAccessToken } from "./connections.ts";
import { requireBundle } from "./graph.ts";

const GRAPH = "https://graph.microsoft.com/v1.0";
const TIMEOUT_MS = 12_000;
/** Rows returned to the model. A tracker with three hundred rows is a report,
 *  not an answer, and pasting it into the prompt buys nothing. */
const MAX_ROWS = 25;

type Json = Record<string, unknown>;

export type Workbook = {
  id: string;
  name: string;
  purpose: string;
  file_url: string;
  drive_id: string | null;
  item_id: string | null;
  table_name: string;
  writable: boolean;
  connected_by: string;
  /** hold (the default) means every write here waits for a person. */
  action_policy?: "auto" | "hold" | null;
  auto_below?: number | null;
  amount_field?: string | null;
};

export async function listWorkbooks(db: SupabaseClient, storeId: string): Promise<Workbook[]> {
  const { data } = await db
    .from("workbook_source")
    .select("id, name, purpose, file_url, drive_id, item_id, table_name, writable, connected_by, action_policy, auto_below, amount_field")
    .eq("store_id", storeId)
    .eq("active", true);
  return ((data ?? []) as Workbook[]);
}

async function call(
  token: string, path: string, init: RequestInit = {},
): Promise<{ ok: true; data: Json } | { ok: false; note: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${GRAPH}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const msg = (data?.error?.message as string | undefined) ?? `Excel returned ${res.status}`;
      return { ok: false, note: msg };
    }
    return { ok: true, data };
  } catch (e) {
    return { ok: false, note: e instanceof Error && e.name === "AbortError" ? "the spreadsheet took too long to respond" : "couldn't reach the spreadsheet" };
  } finally {
    clearTimeout(timer);
  }
}

/** Resolve a pasted file link to a driveItem, and cache it on the row. */
async function locate(
  db: SupabaseClient, token: string, wb: Workbook,
): Promise<{ driveId: string; itemId: string } | null> {
  if (wb.drive_id && wb.item_id) return { driveId: wb.drive_id, itemId: wb.item_id };
  const b64 = btoa(wb.file_url).replace(/=+$/, "").replace(/\//g, "_").replace(/\+/g, "-");
  const res = await call(token, `/shares/u!${b64}/driveItem`);
  if (!res.ok) return null;
  const driveId = ((res.data.parentReference as Json | undefined)?.driveId as string | undefined) ?? null;
  const itemId = res.data.id as string | undefined;
  if (!driveId || !itemId) return null;
  await db.from("workbook_source").update({ drive_id: driveId, item_id: itemId }).eq("id", wb.id);
  return { driveId, itemId };
}

/** The token to work with. Registered against a person, because Files.ReadWrite
 *  is delegated and the write should land as somebody, not as "the system". */
async function tokenFor(
  db: SupabaseClient, store: Store, wb: Workbook, write: boolean,
): Promise<{ token: string } | { offer: Json }> {
  const who = (wb.connected_by ?? "").trim().toLowerCase();
  const token = await getAccessToken(db, store.id, "microsoft", who);
  if (!token) {
    return {
      offer: {
        ok: false,
        note: who
          ? `The ${wb.name} is read with ${who}'s Microsoft 365 access, and that account isn't connected.`
          : `Microsoft 365 isn't connected for this assistant, so I can't open the ${wb.name}.`,
      },
    };
  }
  const allowed = await requireBundle(db, store.id, write ? "spreadsheets_write" : "documents", who);
  return allowed.ok ? { token } : { offer: allowed.offer };
}

function rowsFrom(data: Json): { headers: string[]; rows: string[][] } {
  const values = (data.values as unknown[][] | undefined) ?? [];
  if (values.length === 0) return { headers: [], rows: [] };
  const headers = (values[0] ?? []).map((v) => String(v ?? ""));
  const rows = values.slice(1).map((r) => r.map((v) => (v == null ? "" : String(v))));
  return { headers, rows };
}

/**
 * Read a registered tracker, optionally narrowed by a search term.
 *
 * Filtering happens here rather than in Excel because a Graph filter needs a
 * column name and a data type, and the useful question is almost always "the
 * rows that mention Priya" rather than "rows where column C equals". Matching
 * across the whole row is cruder and answers what was actually asked.
 */
export async function readWorkbook(
  db: SupabaseClient, store: Store, name: string, match?: string,
): Promise<Json> {
  const all = await listWorkbooks(db, store.id);
  const wb = pick(all, name);
  if (!wb) return { ok: false, note: unknownNote(all, name) };

  const t = await tokenFor(db, store, wb, false);
  if ("offer" in t) return t.offer;
  const at = await locate(db, t.token, wb);
  if (!at) return { ok: false, note: `Couldn't open the ${wb.name} file. The link may have changed.` };

  const res = await call(
    t.token,
    `/drives/${at.driveId}/items/${at.itemId}/workbook/tables/${encodeURIComponent(wb.table_name)}/range`,
  );
  if (!res.ok) return { ok: false, note: res.note };

  const { headers, rows } = rowsFrom(res.data);
  const needle = (match ?? "").trim().toLowerCase();
  const hit = needle
    ? rows.filter((r) => r.join(" ").toLowerCase().includes(needle))
    : rows;

  const shown = hit.slice(0, MAX_ROWS).map((r) => {
    const o: Record<string, string> = {};
    headers.forEach((h, i) => { o[h || `col${i + 1}`] = r[i] ?? ""; });
    return o;
  });

  return {
    ok: true,
    tracker: wb.name,
    columns: headers,
    found: hit.length,
    showing: shown.length,
    rows: shown,
    ...(hit.length > shown.length ? { note: `${hit.length} rows match; showing the first ${shown.length}.` } : {}),
  };
}

/**
 * Append a row. The caller decides whether this is held — see tools.ts.
 *
 * Values are matched to the table's OWN header row rather than taken in
 * positional order, so a column inserted in the spreadsheet does not silently
 * start writing dates into the status column.
 */
export async function appendWorkbookRow(
  db: SupabaseClient, store: Store, name: string, values: Record<string, unknown>,
): Promise<Json> {
  const all = await listWorkbooks(db, store.id);
  const wb = pick(all, name);
  if (!wb) return { ok: false, note: unknownNote(all, name) };
  if (!wb.writable) {
    return { ok: false, note: `The ${wb.name} is connected for reading only. Someone who administers this assistant can allow writing to it.` };
  }

  const t = await tokenFor(db, store, wb, true);
  if ("offer" in t) return t.offer;
  const at = await locate(db, t.token, wb);
  if (!at) return { ok: false, note: `Couldn't open the ${wb.name} file.` };

  const base = `/drives/${at.driveId}/items/${at.itemId}/workbook/tables/${encodeURIComponent(wb.table_name)}`;
  const head = await call(t.token, `${base}/headerRowRange`);
  if (!head.ok) return { ok: false, note: head.note };
  const headers = (((head.data.values as unknown[][] | undefined) ?? [[]])[0] ?? []).map((v) => String(v ?? ""));
  if (headers.length === 0) return { ok: false, note: `The ${wb.name} has no header row, so I can't tell where the values go.` };

  // Case- and space-insensitive, because a person saying "start date" should
  // reach a column headed "Start Date" without anybody being told off.
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "");
  const given = new Map(Object.entries(values).map(([k, v]) => [norm(k), v]));
  const unknownKeys = [...given.keys()].filter((k) => !headers.some((h) => norm(h) === k));
  const row = headers.map((h) => {
    const v = given.get(norm(h));
    return v == null ? "" : String(v);
  });

  const res = await call(t.token, `${base}/rows/add`, {
    method: "POST",
    body: JSON.stringify({ values: [row] }),
  });
  if (!res.ok) return { ok: false, note: res.note };

  return {
    ok: true,
    tracker: wb.name,
    added: Object.fromEntries(headers.map((h, i) => [h, row[i]])),
    ...(unknownKeys.length
      ? { note: `The ${wb.name} has no column for ${unknownKeys.join(", ")}, so those were left out. Say so.` }
      : {}),
  };
}

/**
 * Change one row, found by a search term.
 *
 * Refuses when the term matches more than one row. Updating "the row for Priya"
 * when there are two Priyas is the kind of write that looks like it worked and
 * is discovered a month later, so it asks rather than picks.
 */
export async function updateWorkbookRow(
  db: SupabaseClient, store: Store, name: string, match: string, values: Record<string, unknown>,
): Promise<Json> {
  const all = await listWorkbooks(db, store.id);
  const wb = pick(all, name);
  if (!wb) return { ok: false, note: unknownNote(all, name) };
  if (!wb.writable) {
    return { ok: false, note: `The ${wb.name} is connected for reading only.` };
  }
  const needle = (match ?? "").trim().toLowerCase();
  if (!needle) return { ok: false, note: "Say which row to change." };

  const t = await tokenFor(db, store, wb, true);
  if ("offer" in t) return t.offer;
  const at = await locate(db, t.token, wb);
  if (!at) return { ok: false, note: `Couldn't open the ${wb.name} file.` };

  const base = `/drives/${at.driveId}/items/${at.itemId}/workbook/tables/${encodeURIComponent(wb.table_name)}`;
  const res = await call(t.token, `${base}/range`);
  if (!res.ok) return { ok: false, note: res.note };
  const { headers, rows } = rowsFrom(res.data);

  const matches = rows
    .map((r, i) => ({ r, i }))
    .filter((x) => x.r.join(" ").toLowerCase().includes(needle));
  if (matches.length === 0) return { ok: false, note: `Nothing in the ${wb.name} matches "${match}".` };
  if (matches.length > 1) {
    return {
      ok: false,
      note: `${matches.length} rows in the ${wb.name} match "${match}". Ask which one they mean before changing anything.`,
      matches: matches.slice(0, 5).map((x) => Object.fromEntries(headers.map((h, i) => [h, x.r[i] ?? ""]))),
    };
  }

  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "");
  const given = new Map(Object.entries(values).map(([k, v]) => [norm(k), v]));
  const target = matches[0];
  const next = headers.map((h, i) => {
    const v = given.get(norm(h));
    return v == null ? (target.r[i] ?? "") : String(v);
  });

  // Row index within the table body, which is what itemAt expects.
  const upd = await call(t.token, `${base}/rows/itemAt(index=${target.i})`, {
    method: "PATCH",
    body: JSON.stringify({ values: [next] }),
  });
  if (!upd.ok) return { ok: false, note: upd.note };

  return {
    ok: true,
    tracker: wb.name,
    changed: Object.fromEntries(headers.map((h, i) => [h, next[i]])),
    was: Object.fromEntries(headers.map((h, i) => [h, target.r[i] ?? ""])),
  };
}

/** Loose name matching: the model is given the registered names, but people
 *  paraphrase and a near-miss should not become "I don't have that". */
function pick(all: Workbook[], name: string): Workbook | null {
  const n = (name ?? "").trim().toLowerCase();
  if (!n) return null;
  return (
    all.find((w) => w.name.toLowerCase() === n) ??
    all.find((w) => w.name.toLowerCase().includes(n) || n.includes(w.name.toLowerCase())) ??
    null
  );
}

function unknownNote(all: Workbook[], name: string): string {
  if (all.length === 0) return "No trackers are connected to this assistant yet.";
  return `There's no tracker called "${name}". The ones connected are: ${all.map((w) => w.name).join(", ")}.`;
}
