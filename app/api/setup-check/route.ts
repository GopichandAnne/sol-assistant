import { NextResponse } from "next/server";
import { getActiveStore } from "@/lib/store/active-store";

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
      },
      note:
        "panelAppears false means the console hides that channel. Anything MISSING " +
        "is absent from THIS deployment's environment — setting it in Supabase does " +
        "not set it here, and a change needs a redeploy to take effect.",
    },
    { headers: { "cache-control": "no-store" } },
  );
}
