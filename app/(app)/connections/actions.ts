"use server";

import { getActiveStore } from "@/lib/store/active-store";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { callBotAdmin } from "@/lib/knowledge/bot-admin";

export type QuickToolInput = {
  name: string;
  description: string;
  method: string;
  url: string;
  /** Comma-separated inputs the model provides, "*" = required, e.g. "id*, status". */
  params: string;
  /** "none" = public endpoint; "identity" = call as the signed-in customer. */
  auth: "none" | "identity";
  hold: boolean;
};

/**
 * Quick-add a single API endpoint as a tool — the low-friction path for owners
 * who don't have an OpenAPI spec. Writes an http_tool row directly (owner-gated,
 * service role). The created tool then appears in the tool list with the same
 * Auto/Hold + delete controls. v1: no-auth or act-as-signed-in-customer (an
 * API-key endpoint still goes through the OpenAPI importer, which encrypts the
 * key in the edge runtime where the encryption key lives).
 */
export async function saveQuickTool(input: QuickToolInput): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getActiveStore();
  if (!ctx?.active) return { ok: false, error: "You're not signed in." };
  if (ctx.active.role !== "owner" && !ctx.isPlatformAdmin) {
    return { ok: false, error: "Only the account owner can add tools." };
  }

  const name = input.name.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  if (!name) return { ok: false, error: "Give the tool a short name (e.g. check_order_status)." };
  const description = input.description.trim();
  if (!description) return { ok: false, error: "Describe when the assistant should call it." };
  const method = (input.method || "GET").toUpperCase();

  let base = "", path = "";
  try {
    const u = new URL(input.url.trim());
    base = u.origin;
    path = u.pathname + (u.search || "");
  } catch {
    return { ok: false, error: "Enter a full URL, e.g. https://api.example.com/orders/{id}." };
  }

  // "id*, status" → JSON-Schema params + a request_map. A {name} placeholder in the
  // path → path param; otherwise a GET query param, or a body field for writes.
  const properties: Record<string, { type: string; description: string }> = {};
  const required: string[] = [];
  const request_map: { param: string; in: "path" | "query" | "body" }[] = [];
  for (const tok of input.params.split(",").map((s) => s.trim()).filter(Boolean)) {
    const isReq = tok.endsWith("*");
    const p = tok.replace(/\*+$/, "").trim();
    if (!p) continue;
    const loc: "path" | "query" | "body" = path.includes(`{${p}}`) ? "path" : method === "GET" ? "query" : "body";
    properties[p] = { type: "string", description: p };
    if (isReq) required.push(p);
    request_map.push({ param: p, in: loc });
  }

  const auth = input.auth === "identity"
    ? { type: "identity", claim: "token", location: "header", name: "Authorization", prefix: "Bearer " }
    : { type: "none" };

  const db = createAdminClient();
  const { error } = await db.from("http_tool").insert({
    store_id: ctx.active.id,
    name,
    description,
    method,
    base_url: base,
    path,
    params: { type: "object", properties, required },
    request_map,
    auth,
    api_key: null,
    side_effect: method !== "GET",
    timeout_ms: 6000,
    action_policy: input.hold ? "hold" : "auto",
    enabled: true,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Disconnect a connected provider. Runs through the oauth-disconnect edge function
 * (owner-authed), which best-effort REVOKES the grant at the provider and then
 * deletes our stored tokens. We go via the edge runtime because the OAuth app
 * secrets + token-encryption key live there, not in this app. Owner only.
 */
export async function disconnectProvider(provider: string): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getActiveStore();
  if (!ctx?.active) return { ok: false, error: "You're not signed in." };
  if (ctx.active.role !== "owner") return { ok: false, error: "Only the store owner can change connections." };

  const supabase = await createClient();
  const { data, error } = await supabase.functions.invoke("oauth-disconnect", {
    body: { storeSlug: ctx.active.slug, provider },
  });
  const err = error?.message ?? (data as { error?: string } | null)?.error;
  if (err || !(data as { ok?: boolean } | null)?.ok) return { ok: false, error: err ?? "Couldn't disconnect." };
  return { ok: true };
}

/* ── Microsoft 365 capabilities ──────────────────────────────────────────────
 * Connecting Microsoft 365 asks only for the permissions a person can approve
 * for themselves. Each further capability — documents, mail, calendar, tasks —
 * is approved separately, so an organisation grants what it wants and nothing
 * else, and a security review has something specific to say yes to.
 * -------------------------------------------------------------------------- */

export type M365Capability = {
  key: string;
  label: string;
  why: string;
  /** false for what connecting already covers, so it renders as included. */
  optional: boolean;
  enabled: boolean;
};

/** What this assistant's Microsoft 365 connection can do today. */
export async function listM365Capabilities(): Promise<
  { ok: true; connected: boolean; bundles: M365Capability[] } | { ok: false; error: string }
> {
  const ctx = await getActiveStore();
  if (!ctx?.active) return { ok: false, error: "No active assistant." };
  const res = await callBotAdmin({ action: "m365_capabilities", store_slug: ctx.active.slug });
  if (!res.ok) return { ok: false, error: res.error };
  const d = res.data as { connected?: boolean; bundles?: M365Capability[] };
  return { ok: true, connected: !!d.connected, bundles: d.bundles ?? [] };
}

/**
 * The link that adds one capability to the organisation's connection.
 *
 * Owner-only, because it grants the assistant more reach into their systems. The
 * link is minted server-side and asks for what is already approved plus the new
 * capability, so approving one more thing never narrows what already worked.
 */
export async function m365ConsentUrl(
  bundle: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const ctx = await getActiveStore();
  if (!ctx?.active) return { ok: false, error: "No active assistant." };
  if (!(ctx.active.role === "owner" || ctx.isPlatformAdmin)) {
    return { ok: false, error: "Only the account owner can approve more access." };
  }
  const res = await callBotAdmin({ action: "m365_consent_url", store_slug: ctx.active.slug, bundle });
  if (!res.ok) return { ok: false, error: res.error };
  const url = (res.data as { url?: string }).url;
  return url ? { ok: true, url } : { ok: false, error: "Couldn't build the approval link." };
}
