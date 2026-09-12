import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getActiveStore } from "@/lib/store/active-store";
import { createAdminClient } from "@/lib/supabase/admin";
import { ConnectionsClient, type ConnStatus } from "./connections-client";
import { ApiBuilder, type ApiTool } from "./api-builder";
import { QuickTool } from "./quick-tool";
import { McpServers, type McpServerRow, type McpToolRow } from "./mcp-servers";
import { listM365Capabilities, type M365Capability } from "./actions";

export const metadata: Metadata = { title: "Tools & systems · The Assistant" };
export const dynamic = "force-dynamic";

/**
 * Connections — the OAuth broker's front door. The owner clicks "Connect" on a
 * provider, authorizes on the provider's own site, and the assistant gets the tokens (the
 * model never sees them). Read the current status from the vault (service role;
 * the table has no client policies).
 */
export default async function ConnectionsPage() {
  const ctx = await getActiveStore();
  if (!ctx) redirect("/login");
  if (!ctx.active) redirect("/welcome");

  const db = createAdminClient();
  // The ORGANISATION's connections only. People connect their own accounts too —
  // for their mail, calendar and tasks — and showing one of those here would tell
  // an owner the assistant is connected when in fact only a colleague is.
  const { data } = await db
    .from("oauth_connection")
    .select("provider, account_label, status")
    .eq("store_id", ctx.active.id)
    .eq("status", "connected")
    .eq("user_key", "");

  const connected: Record<string, ConnStatus> = {};
  for (const r of (data ?? []) as { provider: string; account_label: string | null; status: string }[]) {
    connected[r.provider] = { label: r.account_label };
  }

  // How many people have connected their own — worth knowing, because it is the
  // number that decides whether the personal tools do anything for the team.
  const { data: personalRows } = await db
    .from("oauth_connection")
    .select("provider")
    .eq("store_id", ctx.active.id)
    .eq("status", "connected")
    .neq("user_key", "");
  const personalCounts: Record<string, number> = {};
  for (const r of (personalRows ?? []) as { provider: string }[]) {
    personalCounts[r.provider] = (personalCounts[r.provider] ?? 0) + 1;
  }

  // Microsoft 365 starts narrow by design and grows one approval at a time, so the
  // card shows what it is allowed to do rather than a single connected tick.
  let m365: M365Capability[] = [];
  if (connected["microsoft"]) {
    const caps = await listM365Capabilities();
    if (caps.ok) m365 = caps.bundles;
  }

  const { data: toolRows } = await db
    .from("http_tool")
    .select("id, name, description, method, side_effect, auth, action_policy")
    .eq("store_id", ctx.active.id)
    .order("created_at", { ascending: false });
  const customTools = (toolRows ?? []) as ApiTool[];

  const [{ data: mcpServerRows }, { data: mcpToolRows }] = await Promise.all([
    db.from("mcp_server").select("id, name, url, auth, enabled").eq("store_id", ctx.active.id).order("created_at", { ascending: false }),
    db.from("mcp_tool").select("id, server_id, name, remote_name, description, side_effect, enabled, action_policy").eq("store_id", ctx.active.id).order("remote_name"),
  ]);

  return (
    <div className="mx-auto max-w-2xl p-4">
      <div className="mb-5">
        <h1 className="text-lg font-semibold">Tools &amp; systems</h1>
        <p className="text-muted-foreground text-sm">
          Connect the tools you already use. One click, sign in on their site — the assistant gets access, and never sees your password.
        </p>
      </div>
      <details className="bg-card mb-5 rounded-lg border p-4 text-sm [&_summary]:cursor-pointer">
        <summary className="font-medium">How the assistant uses your tools</summary>
        <div className="text-muted-foreground mt-3 space-y-2">
          <p>The assistant sees every connected tool with its description. When someone&apos;s question matches, it calls it — and it can <b>chain</b> several (look something up, then act) before answering.</p>
          <ul className="list-disc space-y-1 pl-5">
            <li><b>Reads</b> run on their own. <b>Writes</b> wait for the person to confirm.</li>
            <li>A tool set to <b>🔒 Hold</b> never runs itself — the assistant flags it for a person.</li>
            <li>Every call is recorded in <a href="/activity" className="text-teal-deep underline">Activity</a> — what it did, and as whom.</li>
          </ul>
          <p>Steer it from the <a href="/agent" className="text-teal-deep underline">Agent</a> prompt — describe the <i>situation</i>, not the tool name: e.g. <i>&ldquo;when someone asks about their access request, look it up and answer with the real status.&rdquo;</i></p>
        </div>
      </details>

      <ConnectionsClient
        storeSlug={ctx.active.slug}
        isOwner={ctx.active.role === "owner"}
        connected={connected}
        personalCounts={personalCounts}
        m365Capabilities={m365}
      />
      <div className="mt-6">
        <QuickTool isOwner={ctx.active.role === "owner" || ctx.isPlatformAdmin} />
      </div>
      <ApiBuilder storeSlug={ctx.active.slug} isOwner={ctx.active.role === "owner"} tools={customTools} connectedProviders={Object.keys(connected)} />
      <McpServers
        storeSlug={ctx.active.slug}
        isOwner={ctx.active.role === "owner"}
        initialServers={(mcpServerRows ?? []) as McpServerRow[]}
        initialTools={(mcpToolRows ?? []) as McpToolRow[]}
        connectedProviders={Object.keys(connected)}
      />
    </div>
  );
}
