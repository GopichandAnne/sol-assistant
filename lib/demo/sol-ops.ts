import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { untyped } from "@/lib/supabase/untyped";

/**
 * Sol's operational records, behind an API.
 *
 * Standing in for four spreadsheets the assistant cannot reach until an
 * administrator approves the Microsoft scopes. Same data, same numbers, reached
 * the way a client system is reached: a key, a path, JSON.
 *
 * Filtering happens here rather than being pushed into the query, because the
 * useful question is almost always "the rows that mention Priya" or "the ones
 * that have not been submitted", not "where column C equals". Matching across
 * the whole record is cruder and answers what was actually asked.
 */

export const DATASETS = ["bench", "engagements", "compliance", "timesheets"] as const;
export type Dataset = (typeof DATASETS)[number];

export type OpsRow = { ref: string; [k: string]: unknown };

const TENANT = "sol";
/** A dataset is a report past this; pasting three hundred rows into a prompt
 *  buys nothing and crowds out the documents. */
const MAX_ROWS = 60;

export function isDataset(v: string): v is Dataset {
  return (DATASETS as readonly string[]).includes(v);
}

/**
 * Whether the caller presented the right key.
 *
 * Refuses everything when DEMO_API_KEY is unset rather than falling back to a
 * default: a published endpoint that writes to a database and accepts a
 * well-known key is not a demo, it is an open door.
 */
export function checkKey(header: string | null): { ok: true } | { ok: false; status: number; error: string } {
  const expected = process.env.DEMO_API_KEY;
  if (!expected) return { ok: false, status: 503, error: "This demo API has not been switched on for this deployment." };
  const given = (header ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!given) return { ok: false, status: 401, error: "Missing API key." };
  if (given !== expected) return { ok: false, status: 401, error: "That API key is not recognised." };
  return { ok: true };
}

type Row = { ref: string; data: Record<string, unknown> };

export async function listRows(
  dataset: Dataset,
  opts: { match?: string; where?: Record<string, string>; limit?: number },
): Promise<OpsRow[]> {
  const from = untyped(createAdminClient());
  const { data } = await from("demo_ops_row")
    .select("ref, data")
    .eq("tenant", TENANT)
    .eq("dataset", dataset)
    .order("ref");

  let rows = ((data ?? []) as Row[]).map((r) => ({ ref: r.ref, ...r.data }));

  const needle = (opts.match ?? "").trim().toLowerCase();
  if (needle) {
    rows = rows.filter((r) => JSON.stringify(r).toLowerCase().includes(needle));
  }

  // Field filters are matched loosely on purpose: a caller asking for
  // status "open" should reach "Open", and one asking for submitted "no" should
  // reach "No". Exactness here would only produce empty answers that look like
  // missing data.
  for (const [field, want] of Object.entries(opts.where ?? {})) {
    const w = want.trim().toLowerCase();
    if (!w) continue;
    const f = field.trim().toLowerCase().replace(/[\s_]+/g, "");
    rows = rows.filter((r) => {
      const hit = Object.entries(r).find(([k]) => k.trim().toLowerCase().replace(/[\s_]+/g, "") === f);
      return hit ? String(hit[1] ?? "").trim().toLowerCase() === w : false;
    });
  }

  return rows.slice(0, Math.min(Math.max(opts.limit ?? MAX_ROWS, 1), MAX_ROWS));
}

export async function addRow(
  dataset: Dataset,
  values: Record<string, unknown>,
): Promise<{ ok: true; row: OpsRow } | { ok: false; error: string }> {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (k.trim()) clean[k.trim()] = v == null ? "" : String(v);
  }
  if (Object.keys(clean).length === 0) return { ok: false, error: "Nothing to add." };

  // A reference the caller can quote back and address later. Prefers a value the
  // record already carries over a generated id, because "Ellie Frost" is what a
  // person will say next, not a uuid.
  const named = clean.Name ?? clean.name ?? clean.Client ?? clean.client ?? "";
  const ref = String(named).trim() || `${dataset}-${Date.now().toString().slice(-6)}`;

  const from = untyped(createAdminClient());
  const { error } = await from("demo_ops_row").insert({ tenant: TENANT, dataset, ref, data: clean });
  if (error) return { ok: false, error: error.message };
  return { ok: true, row: { ref, ...clean } };
}

/**
 * Change one record, found by its reference.
 *
 * Refuses when the reference matches more than one row. Updating "the row for
 * Priya" when there are two is the write that looks like it worked and is
 * discovered a month later, so it asks rather than picks.
 */
export async function updateRow(
  dataset: Dataset,
  ref: string,
  values: Record<string, unknown>,
): Promise<{ ok: true; row: OpsRow; was: OpsRow } | { ok: false; error: string; matches?: OpsRow[] }> {
  const needle = (ref ?? "").trim().toLowerCase();
  if (!needle) return { ok: false, error: "Say which record to change." };

  const from = untyped(createAdminClient());
  const { data } = await from("demo_ops_row")
    .select("id, ref, data").eq("tenant", TENANT).eq("dataset", dataset);
  const all = (data ?? []) as { id: string; ref: string; data: Record<string, unknown> }[];

  let hits = all.filter((r) => r.ref.toLowerCase() === needle);
  if (hits.length === 0) {
    hits = all.filter((r) => JSON.stringify({ ref: r.ref, ...r.data }).toLowerCase().includes(needle));
  }
  if (hits.length === 0) return { ok: false, error: `Nothing in ${dataset} matches "${ref}".` };
  if (hits.length > 1) {
    return {
      ok: false,
      error: `${hits.length} records in ${dataset} match "${ref}". Ask which one before changing anything.`,
      matches: hits.slice(0, 5).map((h) => ({ ref: h.ref, ...h.data })),
    };
  }

  const target = hits[0];
  // Merged by column name, ignoring case and spacing, so "week ending" reaches a
  // field called "Week Ending" rather than adding a second one beside it.
  const norm = (s: string) => s.trim().toLowerCase().replace(/[\s_]+/g, "");
  const next: Record<string, unknown> = { ...target.data };
  for (const [k, v] of Object.entries(values)) {
    const existing = Object.keys(next).find((e) => norm(e) === norm(k));
    next[existing ?? k.trim()] = v == null ? "" : String(v);
  }

  const { error } = await from("demo_ops_row")
    .update({ data: next, updated_at: new Date().toISOString() }).eq("id", target.id);
  if (error) return { ok: false, error: error.message };

  return { ok: true, row: { ref: target.ref, ...next }, was: { ref: target.ref, ...target.data } };
}
