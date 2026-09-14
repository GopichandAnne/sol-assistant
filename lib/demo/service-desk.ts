import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { untyped } from "@/lib/supabase/untyped";

/**
 * The mock service desk behind both the REST API and the MCP endpoint.
 *
 * One implementation, two front doors, because the point of the demo is that
 * connecting a system is easy whichever shape it arrives in — and because two
 * implementations would drift and one of them would be wrong on stage.
 *
 * Every function here answers in the vocabulary of a ticketing system rather
 * than of our database. That is not decoration: the assistant reads these field
 * names when deciding what to do, and "status" and "assignee" tell it more than
 * a column called `state_id` ever would.
 */

export type Ticket = {
  ref: string;
  title: string;
  description: string | null;
  requester: string | null;
  assignee: string | null;
  category: string;
  priority: string;
  status: string;
  created_at: string;
  updated_at: string;
};

const TENANT = "northwind";
const FIELDS = "ref, title, description, requester, assignee, category, priority, status, created_at, updated_at";

/**
 * Whether the caller presented the right key.
 *
 * Deliberately refuses everything when DEMO_API_KEY is unset rather than falling
 * back to a default. A published endpoint that writes to a database and accepts
 * a well-known key is not a demo, it is an open door.
 */
export function checkKey(header: string | null): { ok: true } | { ok: false; status: number; error: string } {
  const expected = process.env.DEMO_API_KEY;
  if (!expected) {
    return { ok: false, status: 503, error: "This demo API has not been switched on for this deployment." };
  }
  const given = (header ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!given) return { ok: false, status: 401, error: "Missing API key." };
  if (given !== expected) return { ok: false, status: 401, error: "That API key is not recognised." };
  return { ok: true };
}

export async function listTickets(opts: {
  status?: string; assignee?: string; requester?: string; q?: string; limit?: number;
}): Promise<Ticket[]> {
  const from = untyped(createAdminClient());
  let query = from("demo_ticket").select(FIELDS).eq("tenant", TENANT);
  if (opts.status) query = query.ilike("status", opts.status);
  if (opts.assignee) query = query.ilike("assignee", `%${opts.assignee}%`);
  if (opts.requester) query = query.ilike("requester", `%${opts.requester}%`);
  if (opts.q) query = query.or(`title.ilike.%${opts.q}%,description.ilike.%${opts.q}%`);
  const { data } = await query
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(opts.limit ?? 20, 1), 100));
  return (data ?? []) as Ticket[];
}

export async function getTicket(ref: string): Promise<Ticket | null> {
  const from = untyped(createAdminClient());
  const { data } = await from("demo_ticket")
    .select(FIELDS).eq("tenant", TENANT).ilike("ref", ref.trim()).maybeSingle();
  return (data as Ticket | null) ?? null;
}

export async function createTicket(input: {
  title: string; description?: string; requester?: string; category?: string; priority?: string;
}): Promise<{ ok: true; ticket: Ticket } | { ok: false; error: string }> {
  const title = (input.title ?? "").trim();
  if (!title) return { ok: false, error: "A title is required." };

  const db = createAdminClient();
  const from = untyped(db);
  // The reference comes from a sequence in SQL, so two people demoing at once are
  // not both told they raised INC-1041.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: nextRef } = await (db as any).rpc("next_demo_ticket_ref");
  const ref = String(nextRef ?? "").trim() || `INC-${Date.now().toString().slice(-4)}`;

  const row = {
    tenant: TENANT,
    ref,
    title,
    description: (input.description ?? "").trim() || null,
    requester: (input.requester ?? "").trim().toLowerCase() || null,
    category: (input.category ?? "General").trim() || "General",
    priority: normalisePriority(input.priority),
    status: "Open",
  };
  const { data, error } = await from("demo_ticket").insert(row).select(FIELDS).maybeSingle();
  if (error) return { ok: false, error: error.message };
  return { ok: true, ticket: data as Ticket };
}

export async function updateTicket(ref: string, input: {
  status?: string; assignee?: string; priority?: string; note?: string;
}): Promise<{ ok: true; ticket: Ticket } | { ok: false; error: string }> {
  const existing = await getTicket(ref);
  if (!existing) return { ok: false, error: `No ticket called ${ref}.` };

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.status) {
    const s = normaliseStatus(input.status);
    if (!s) return { ok: false, error: `"${input.status}" is not a status. Use Open, In progress, Waiting, Resolved or Closed.` };
    patch.status = s;
  }
  if (input.assignee !== undefined) patch.assignee = input.assignee.trim().toLowerCase() || null;
  if (input.priority) patch.priority = normalisePriority(input.priority);
  // A note is appended rather than replacing the description, because a ticket's
  // history is the useful part and overwriting it loses why anything happened.
  if (input.note?.trim()) {
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    patch.description = `${existing.description ?? ""}\n\n[${stamp}] ${input.note.trim()}`.trim();
  }

  const from = untyped(createAdminClient());
  const { data, error } = await from("demo_ticket")
    .update(patch).eq("tenant", TENANT).ilike("ref", ref.trim()).select(FIELDS).maybeSingle();
  if (error) return { ok: false, error: error.message };
  return { ok: true, ticket: data as Ticket };
}

function normalisePriority(v?: string): string {
  const p = (v ?? "").trim().toLowerCase();
  if (p.startsWith("urg") || p === "p1") return "Urgent";
  if (p.startsWith("hi") || p === "p2") return "High";
  if (p.startsWith("lo") || p === "p4") return "Low";
  return "Normal";
}

function normaliseStatus(v: string): string | null {
  const s = v.trim().toLowerCase();
  if (s.startsWith("open") || s === "new") return "Open";
  if (s.startsWith("in prog") || s === "active" || s === "wip") return "In progress";
  if (s.startsWith("wait") || s.startsWith("pend") || s.startsWith("hold")) return "Waiting";
  if (s.startsWith("resolv") || s.startsWith("fix") || s.startsWith("done")) return "Resolved";
  if (s.startsWith("clos")) return "Closed";
  return null;
}
