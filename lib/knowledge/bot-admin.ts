// Server-only bridge to the bot-admin Edge Function. Knowledge-base writes
// (ingest/delete/sync) go through bot-admin because knowledge_index is
// service-role-write; the calling server action does the owner authorization
// first, then this executes the mutation with the service-role key + admin
// secret. Never import from a client component.

type BotAdminOk = { ok: true; data: Record<string, unknown> };
type BotAdminErr = { ok: false; error: string };

export async function callBotAdmin(
  payload: Record<string, unknown>,
): Promise<BotAdminOk | BotAdminErr> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const adminSecret = process.env.ADMIN_TASK_SECRET;
  if (!base || !serviceKey || !adminSecret) {
    // Named precisely, because this bridge carries far more than indexing:
    // approvals, inbox replies, agent settings. A message that says "indexing"
    // on the Approve button sends whoever reads it looking in the wrong place.
    const missing = [!base && "NEXT_PUBLIC_SUPABASE_URL", !serviceKey && "SUPABASE_SERVICE_ROLE_KEY", !adminSecret && "ADMIN_TASK_SECRET"]
      .filter(Boolean).join(", ");
    return {
      ok: false,
      error: `The console can't reach the assistant's back end: ${missing} is not set on this deployment.`,
    };
  }
  try {
    const res = await fetch(`${base}/functions/v1/bot-admin`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "x-admin-secret": adminSecret,
      },
      body: JSON.stringify(payload),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return { ok: false, error: String(data.error ?? `The back end refused the request (HTTP ${res.status}).` ) };
    }
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Indexing request failed." };
  }
}
