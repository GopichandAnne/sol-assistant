import { NextResponse } from "next/server";
import { getActiveStore } from "@/lib/store/active-store";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTeamsStatus } from "@/app/(app)/link/teams-actions";
import { getSlackStatus } from "@/app/(app)/link/slack-actions";

/**
 * What this deployment can actually see.
 *
 * The channel panels switch themselves on from environment variables, and a
 * missing one is silent by design: nothing errors, the feature simply never
 * appears. That is the right behaviour for a client's console and the wrong
 * behaviour for whoever is setting it up, who is left redeploying and hoping.
 *
 * So: an owner-only readout of which values are present. Secrets are reported as
 * a yes or no and never echoed — a value that can be read back is a value that
 * can be read over a shoulder. Identifiers that ship publicly anyway (the Azure
 * app id travels in the Teams manifest; the Slack client id in the install URL)
 * are shown in full, because confirming the RIGHT id is set is half of what this
 * page is for.
 *
 * It also names the build serving the request, so "I redeployed" can be checked
 * rather than assumed.
 */
export const dynamic = "force-dynamic";

function shown(v: string | undefined): string | null {
  const t = (v ?? "").trim();
  return t ? t : null;
}

export async function GET() {
  const ctx = await getActiveStore();
  if (!ctx?.active) return new NextResponse("Not signed in", { status: 401 });
  if (!(ctx.active.role === "owner" || ctx.isPlatformAdmin)) {
    return new NextResponse("Owners only", { status: 403 });
  }

  const appId = shown(process.env.MICROSOFT_APP_ID);
  const appPassword = !!shown(process.env.MICROSOFT_APP_PASSWORD);
  const slackClientId = shown(process.env.SLACK_CLIENT_ID);
  const slackStateSecret = !!shown(process.env.SLACK_STATE_SECRET);
  const slackRedirect = shown(process.env.SLACK_REDIRECT_URL);

  // The panels don't only need their own variables — they read the database with
  // the service-role client first. When that throws, every channel panel reports
  // "not switched on" at once, which reads like a configuration gap and isn't one.
  // So probe the same path the panels take, and say what actually failed.
  let adminClient = "ok";
  let teamsTable = "not reached";
  let slackTable = "not reached";
  try {
    const db = createAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const from = db.from as unknown as (t: string) => any;
    const t = await from("teams_installs").select("store_id").limit(1);
    teamsTable = t.error ? `error: ${t.error.message}` : "ok";
    const k = await from("slack_installs").select("store_id").limit(1);
    slackTable = k.error ? `error: ${k.error.message}` : "ok";
  } catch (e) {
    adminClient = `FAILED: ${e instanceof Error ? e.message : String(e)}`;
  }

  // The definitive probe: call the very functions the panels call. A server
  // action that throws reaches the browser as a redacted digest, which is correct
  // for a client's console and useless for diagnosing one's own deployment. Here
  // the error is caught deliberately and reported, to the owner, in full.
  let teamsStatus: unknown = null;
  let teamsError: string | null = null;
  try {
    teamsStatus = await getTeamsStatus(ctx.active.id);
  } catch (e) {
    teamsError = e instanceof Error ? `${e.message}` : String(e);
  }
  let slackStatus: unknown = null;
  let slackError: string | null = null;
  try {
    slackStatus = await getSlackStatus(ctx.active.id);
  } catch (e) {
    slackError = e instanceof Error ? `${e.message}` : String(e);
  }

  return NextResponse.json(
    {
      build: {
        environment: process.env.VERCEL_ENV ?? "local",
        commit: (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7) || null,
        deployedAt: process.env.VERCEL_DEPLOYMENT_ID ?? null,
      },
      teams: {
        panelAppears: !!(appId && appPassword),
        MICROSOFT_APP_ID: appId,
        MICROSOFT_APP_PASSWORD: appPassword ? "set" : "MISSING",
      },
      slack: {
        panelAppears: !!(slackClientId && slackStateSecret && slackRedirect),
        SLACK_CLIENT_ID: slackClientId,
        SLACK_STATE_SECRET: slackStateSecret ? "set" : "MISSING",
        SLACK_REDIRECT_URL: slackRedirect,
      },
      supabase: {
        NEXT_PUBLIC_SUPABASE_URL: shown(process.env.NEXT_PUBLIC_SUPABASE_URL),
        SUPABASE_INTERNAL_URL: shown(process.env.SUPABASE_INTERNAL_URL),
        SUPABASE_SERVICE_ROLE_KEY: shown(process.env.SUPABASE_SERVICE_ROLE_KEY) ? "set" : "MISSING",
        adminClient,
        teamsTable,
        slackTable,
      },
      panelCalls: {
        getTeamsStatus: teamsError ? `THREW: ${teamsError}` : teamsStatus,
        getSlackStatus: slackError ? `THREW: ${slackError}` : slackStatus,
      },
      you: {
        store: ctx.active.slug ?? ctx.active.id,
        role: ctx.active.role,
        platformAdmin: ctx.isPlatformAdmin,
      },
      note:
        "panelAppears false means the console hides that channel. Anything MISSING " +
        "is absent from THIS deployment's environment — setting it in Supabase does " +
        "not set it here, and a change needs a redeploy to take effect.",
    },
    { headers: { "cache-control": "no-store" } },
  );
}
