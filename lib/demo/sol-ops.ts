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

/**
 * Each dataset's columns, in the order a person reads them.
 *
 * Stored rows are jsonb, and jsonb does not keep key order, so without this the
 * operations page would show Notes before Name and the export would scramble
 * every column. It is also the vocabulary writes are matched against: a tool
 * sends `hours_non_billable` and the record gets "Hours Non Billable", not a
 * second column beside it.
 */
export const COLUMNS: Record<Dataset, string[]> = {
  bench: ["Name", "Level", "Practice", "Primary Skills", "Current Engagement", "Rolls Off", "Availability", "Location", "Clearances", "Notes"],
  engagements: ["Code", "Client", "Engagement", "Practice", "Partner", "Delivery Lead", "Start", "End", "Fee Type", "Fee", "Currency", "Status", "Margin Target", "Margin Actual"],
  compliance: ["Client", "Engagement Code", "Requirement", "Applies To", "Lead Time", "Owner", "Status", "Renews", "Notes"],
  timesheets: ["Name", "Week Ending", "Engagement Code", "Hours Billable", "Hours Non Billable", "Submitted", "Approved", "Approver", "Notes"],
};

/** How each dataset is named for people, and as an Excel sheet and table. The
 *  table names are the ones the original spreadsheets used, so a download is the
 *  same tracker, not a lookalike. */
export const DATASET_META: Record<Dataset, { label: string; sheet: string; table: string; file: string }> = {
  bench: { label: "Bench", sheet: "Bench and Availability", table: "BenchAndAvailability", file: "Bench-and-Availability" },
  engagements: { label: "Engagements", sheet: "Engagements", table: "Engagements", file: "Engagements" },
  compliance: { label: "Client compliance", sheet: "Client Compliance", table: "ClientCompliance", file: "Client-Compliance" },
  timesheets: { label: "Timesheets", sheet: "Timesheet Status", table: "TimesheetStatus", file: "Timesheet-Status" },
};

const squash = (s: string) => s.trim().toLowerCase().replace(/[\s_-]+/g, "");

/** Map whatever the caller called a field onto the dataset's own column name. */
export function canonicalValues(dataset: Dataset, values: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) {
    if (!k.trim() || k === "ref" || k === "dataset") continue;
    const col = COLUMNS[dataset].find((c) => squash(c) === squash(k)) ?? k.trim();
    out[col] = v == null ? "" : String(v);
  }
  return out;
}

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
  const clean = canonicalValues(dataset, values);
  if (Object.keys(clean).length === 0) return { ok: false, error: "Nothing to add." };

  const from = untyped(createAdminClient());

  // A reference the caller can quote back to change the record later. Bench rows
  // are addressed by the person and engagements by their code, because that is
  // what people say. Compliance items and timesheet weeks have no natural name —
  // "Ellie Frost" matches several of each — so they continue the numbered series
  // the rest of the dataset already uses.
  let ref = "";
  if (dataset === "bench") ref = String(clean.Name ?? "").trim();
  if (dataset === "engagements") ref = String(clean.Code ?? "").trim();
  if (!ref) {
    const { data: existing } = await from("demo_ops_row")
      .select("ref").eq("tenant", TENANT).eq("dataset", dataset);
    const top = ((existing ?? []) as { ref: string }[])
      .map((r) => Number(r.ref.match(/-(\d+)$/)?.[1] ?? 0))
      .reduce((a, b) => Math.max(a, b), 0);
    ref = `${dataset}-${String(top + 1).padStart(3, "0")}`;
  }

  const { error } = await from("demo_ops_row").insert({ tenant: TENANT, dataset, ref, data: clean });
  if (error) return { ok: false, error: error.message };
  return { ok: true, row: { ref, ...clean } };
}

export type ViewRow = { ref: string; data: Record<string, string>; created_at: string; updated_at: string };

/** Every row of every dataset, for the operations page. Unfiltered and uncapped:
 *  a person looking at the record should see all of it, not the sixty rows a
 *  prompt can afford. New rows sort to the bottom, where people look for them. */
export async function allRowsForView(): Promise<Record<Dataset, ViewRow[]>> {
  const from = untyped(createAdminClient());
  const { data } = await from("demo_ops_row")
    .select("dataset, ref, data, created_at, updated_at")
    .eq("tenant", TENANT)
    .order("created_at", { ascending: true })
    .order("ref", { ascending: true });
  const out = { bench: [], engagements: [], compliance: [], timesheets: [] } as Record<Dataset, ViewRow[]>;
  for (const r of (data ?? []) as (ViewRow & { dataset: string })[]) {
    if (isDataset(r.dataset)) out[r.dataset].push({ ref: r.ref, data: r.data, created_at: r.created_at, updated_at: r.updated_at });
  }
  return out;
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
