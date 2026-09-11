// Teams single sign-on: a Graph token for the person talking, without asking them
// for anything.
//
// Today someone in Teams who wants their own mail or calendar has to follow a
// link and connect their Microsoft 365 account. Fifteen seconds, once — but it
// arrives right after their organisation already approved the app, so it reads as
// being asked to approve the same thing twice.
//
// Teams can settle it silently. The bot sends an OAuth card; the Teams client
// exchanges it with Entra and hands the bot a token for that user; the bot swaps
// that token for a Graph token through the OAuth 2.0 on-behalf-of grant. After the
// organisation's one-time consent, nobody clicks anything ever again.
//
// The result is deliberately written to the SAME place a manual connection goes —
// oauth_connection, keyed by the person's email — so every personal tool, the
// refresh path and the capability checks work unchanged. Single sign-on is another
// way to fill that row, not a second mechanism beside it.
//
// Two things here are load-bearing and easy to get wrong:
//
//   • The token arriving in the invoke is NOT trusted because it arrived. It is
//     verified like any other: a real signature against the issuing directory's
//     keys, audience pinned to this bot, and scp = access_as_user. Skip that and a
//     token minted for some other application would be accepted at face value and
//     exchanged for Graph access.
//
//   • The HTTP STATUS is the protocol. 200 means the exchange worked; 412 is what
//     tells the Teams client to fall back to asking the person to consent.
//     Returning 200 on failure leaves them watching a card that never resolves.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { jwksFrom, verifyJwtRs256 } from "./teams-auth.ts";
import { PROVIDERS, saveConnection } from "./connections.ts";

/** Whether single sign-on can be attempted at all. */
export function ssoConfigured(): boolean {
  return !!(Deno.env.get("MICROSOFT_APP_ID") && Deno.env.get("MICROSOFT_APP_PASSWORD"));
}

/** The Bot Framework OAuth connection to name on the card. Without one there is
 *  nothing to put in `connectionName`, so no card can be sent and the manual
 *  connect link stays the route. */
export function ssoConnectionName(): string | null {
  return (Deno.env.get("MICROSOFT_OAUTH_CONNECTION") ?? "").trim() || null;
}

/** Read a JWT's claims WITHOUT verifying, purely to learn which directory issued
 *  it so the right keys can be fetched. Nothing from here is trusted. */
function peek(token: string): Record<string, unknown> | null {
  try {
    const p = token.split(".")[1];
    if (!p) return null;
    const pad = p.length % 4 ? "=".repeat(4 - (p.length % 4)) : "";
    return JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/") + pad));
  } catch {
    return null;
  }
}

export interface SsoClaims {
  tenantId: string;
  email: string | null;
  name: string | null;
  oid: string | null;
}

/**
 * Verify a Teams single sign-on token properly: signed by the directory that
 * issued it, audience is this bot, and it really is the Teams SSO scope rather
 * than some other token the same person happens to hold.
 */
export async function verifySsoToken(token: string, appId: string): Promise<SsoClaims | null> {
  const unverified = peek(token);
  const tid = typeof unverified?.tid === "string" ? unverified.tid : null;
  if (!tid) return null;

  const jwks = await jwksFrom(`https://login.microsoftonline.com/${tid}/v2.0/.well-known/openid-configuration`);
  const claims = await verifyJwtRs256(token, jwks as { keys: unknown[] }, {
    issuer: [`https://login.microsoftonline.com/${tid}/v2.0`, `https://sts.windows.net/${tid}/`],
    audience: appId,
  });
  if (!claims) return null;

  // The scope Teams issues for an app's own API. Its absence means the token was
  // minted for something else and must not be exchanged on this person's behalf.
  const scp = String(claims.scp ?? "");
  if (!scp.split(/\s+/).includes("access_as_user")) {
    console.warn("[teams-sso] token rejected: scp is not access_as_user");
    return null;
  }

  return {
    tenantId: tid,
    email: (claims.preferred_username as string) || (claims.upn as string) || (claims.email as string) || null,
    name: (claims.name as string) ?? null,
    oid: (claims.oid as string) ?? null,
  };
}

interface Exchanged {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  scope: string | null;
}

/**
 * Swap this person's sign-on token for a Graph token, as them.
 *
 * Asks only for the connect-time scope set. Anything heavier — their mail, their
 * files — stays a capability the organisation approves separately, exactly as for
 * a manually connected account. On-behalf-of cannot conjure consent that was never
 * given, and asking for more than was granted just moves the failure later.
 */
export async function exchangeOnBehalfOf(
  appId: string,
  appSecret: string,
  tenantId: string,
  assertion: string,
): Promise<Exchanged | null> {
  const scope = PROVIDERS.microsoft.scope;
  try {
    const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        client_id: appId,
        client_secret: appSecret,
        assertion,
        scope,
        requested_token_use: "on_behalf_of",
      }).toString(),
    });
    const j = await res.json();
    if (!res.ok || !j?.access_token) {
      // invalid_grant here almost always means consent is missing rather than
      // anything being broken. The caller turns that into a 412, so the person is
      // asked instead of left waiting.
      console.warn(
        `[teams-sso] on-behalf-of refused: ${j?.error ?? res.status} ${String(j?.error_description ?? "").slice(0, 160)}`,
      );
      return null;
    }
    return {
      accessToken: j.access_token,
      refreshToken: j.refresh_token ?? null,
      expiresAt: j.expires_in ? new Date(Date.now() + Number(j.expires_in) * 1000).toISOString() : null,
      scope: j.scope ?? scope,
    };
  } catch (e) {
    console.warn(`[teams-sso] on-behalf-of failed: ${(e as Error)?.message ?? e}`);
    return null;
  }
}

/**
 * Handle a signin/tokenExchange invoke: verify, exchange, store.
 *
 * Returns the HTTP status to reply with, because for this activity the status is
 * the answer — 200 accepted, 412 "ask them to consent".
 */
export async function handleTokenExchange(
  db: SupabaseClient,
  storeId: string,
  activity: Record<string, unknown>,
): Promise<number> {
  const appId = Deno.env.get("MICROSOFT_APP_ID") ?? "";
  const appSecret = Deno.env.get("MICROSOFT_APP_PASSWORD") ?? "";
  if (!appId || !appSecret) return 412;

  const value = (activity.value ?? {}) as Record<string, unknown>;
  const token = typeof value.token === "string" ? value.token : "";
  if (!token) return 412;

  const claims = await verifySsoToken(token, appId);
  if (!claims) return 412;
  if (!claims.email) {
    console.warn("[teams-sso] exchanged token carries no address — nothing to key a connection to");
    return 412;
  }

  const tokens = await exchangeOnBehalfOf(appId, appSecret, claims.tenantId, token);
  if (!tokens) return 412;

  try {
    // Into the same store a manual connection uses, keyed the same way, so every
    // personal tool and the refresh path work without knowing how it got there.
    await saveConnection(db, storeId, "microsoft", tokens, claims.email, null, claims.email);
  } catch (e) {
    console.error(`[teams-sso] could not store the connection: ${(e as Error)?.message ?? e}`);
    return 412;
  }
  console.log(`[teams-sso] connected ${claims.email} by single sign-on`);
  return 200;
}

/**
 * The card that starts it. Teams sees `tokenExchangeResource` and attempts the
 * silent exchange before ever showing the person a button.
 */
export function oauthCard(connectionName: string, appId: string, text: string): Record<string, unknown> {
  return {
    contentType: "application/vnd.microsoft.card.oauth",
    content: {
      text,
      connectionName,
      // Only `id` is honoured on the Teams channel, and it must be unique per
      // request so concurrent exchanges cannot be confused for one another.
      tokenExchangeResource: { id: `${appId}-${crypto.randomUUID()}` },
      buttons: [{ type: "signin", title: "Connect", value: "" }],
    },
  };
}
