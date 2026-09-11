// Microsoft Teams / Bot Framework auth. Incoming activities carry a Bearer JWT; we
// verify it against the published JWKS of whichever directory issued it (see the
// tenant note below), with the audience pinned to our bot's app id. Outbound replies + the Graph email lookup use an app
// (client-credentials) token. The verify core is pure (JWKS passed in) so it's testable.

const RS: Record<string, string> = { RS256: "SHA-256", RS384: "SHA-384", RS512: "SHA-512" };

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64urlToStr(s: string): string {
  return new TextDecoder().decode(b64urlToBytes(s));
}

/** Verify an RS* JWT against an already-fetched JWKS + issuer/audience. Pure (no
 *  network) so it can be unit-tested with a generated keypair. Returns the payload
 *  claims or null. */
export async function verifyJwtRs256(
  token: string,
  // deno-lint-ignore no-explicit-any
  jwks: { keys: any[] },
  opts: { issuer?: string | string[]; audience?: string },
  nowSec: number = Date.now() / 1000,
): Promise<Record<string, unknown> | null> {
  try {
    const [h, p, s] = token.split(".");
    if (!h || !p || !s) return null;
    const header = JSON.parse(b64urlToStr(h));
    const hash = RS[header.alg];
    if (!hash) return null; // RS* only — never HS*/none from JWKS
    const jwk = jwks.keys.find((k) => k.kid === header.kid) || (jwks.keys.length === 1 ? jwks.keys[0] : null);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash }, false, ["verify"]);
    const ok = await crypto.subtle.verify(
      { name: "RSASSA-PKCS1-v1_5" },
      key,
      b64urlToBytes(s) as unknown as BufferSource,
      new TextEncoder().encode(`${h}.${p}`) as unknown as BufferSource,
    );
    if (!ok) return null;
    const payload = JSON.parse(b64urlToStr(p)) as Record<string, unknown>;
    if (payload.exp && nowSec > Number(payload.exp) + 300) return null; // 5-min clock skew
    if (payload.nbf && nowSec < Number(payload.nbf) - 300) return null;
    if (opts.issuer) {
      const allowed = Array.isArray(opts.issuer) ? opts.issuer : [opts.issuer];
      if (!allowed.includes(String(payload.iss))) return null;
    }
    if (opts.audience && String(payload.aud) !== opts.audience) return null;
    return payload;
  } catch {
    return null;
  }
}

// ── Network: JWKS + tokens + outbound ────────────────────────────────────────
//
// Two things carry a "tenant" here and they are NOT the same thing:
//
//   The Azure Bot resource type   Since multi-tenant bot creation was retired in
//                                 July 2025 (enforced in the API, not just the
//                                 portal), every new bot is Single Tenant.
//
//   The Entra app registration    This is what actually governs which directories
//                                 the bot can reach. A multi-tenant registration
//                                 behind a single-tenant bot resource still works
//                                 cross-tenant, and is the shape Microsoft points
//                                 ISVs at.
//
// Which of the two issued an inbound token therefore depends on a registration we
// do not control from here. So rather than guess from configuration, verification
// tries the Bot Framework issuer first and falls back to the bot's own directory
// when MICROSOFT_APP_TENANT_ID names one. Both paths pin the audience to our app
// id and check a real signature; accepting either issuer widens nothing.
const BF_OPENID = "https://login.botframework.com/v1/.well-known/openidconfiguration";
const BF_ISSUER = "https://api.botframework.com";

/** The bot's home directory, when it is registered to one. */
function botTenant(): string | null {
  const t = (Deno.env.get("MICROSOFT_APP_TENANT_ID") ?? "").trim();
  return t || null;
}

// deno-lint-ignore no-explicit-any
const jwksCache = new Map<string, { keys: any[]; exp: number }>();

/** Signing keys from one OpenID metadata document, cached per source so the two
 *  issuers can never be served each other's keys. */
async function jwksFrom(metadataUrl: string): Promise<{ keys: unknown[] }> {
  const hit = jwksCache.get(metadataUrl);
  if (hit && hit.exp > Date.now()) return hit;
  const cfg = await (await fetch(metadataUrl)).json();
  const jwks = await (await fetch(cfg.jwks_uri)).json();
  const entry = { keys: jwks.keys ?? [], exp: Date.now() + 12 * 60 * 60 * 1000 }; // 12h
  jwksCache.set(metadataUrl, entry);
  return entry;
}

/** Verify an incoming Bot Framework request token → its claims, or null. */
export async function verifyBotFrameworkToken(token: string, appId: string): Promise<Record<string, unknown> | null> {
  if (!token || !appId) return null;

  // Bot Framework's own issuer: what a multi-tenant app registration produces, and
  // still the common case.
  const bf = await jwksFrom(BF_OPENID);
  const viaBf = await verifyJwtRs256(
    token, bf as { keys: unknown[] }, { issuer: BF_ISSUER, audience: appId },
  );
  if (viaBf) return viaBf;

  // Otherwise the bot's own directory, when one is configured. Both issuer forms
  // are accepted: the directory issues v2.0, while some paths still present the
  // legacy sts.windows.net form for the same tenant.
  const tenant = botTenant();
  if (!tenant) return null;
  const dir = await jwksFrom(`https://login.microsoftonline.com/${tenant}/v2.0/.well-known/openid-configuration`);
  return await verifyJwtRs256(token, dir as { keys: unknown[] }, {
    issuer: [
      `https://login.microsoftonline.com/${tenant}/v2.0`,
      `https://sts.windows.net/${tenant}/`,
    ],
    audience: appId,
  });
}

/** Client-credentials token for a scope (outbound Bot Framework or Graph). */
async function appToken(appId: string, appPassword: string, scope: string, tenant?: string): Promise<string | null> {
  // A single-tenant bot must ask its own directory; a multi-tenant one asks
  // botframework.com. Callers that already know the tenant (the Graph lookup) pass it.
  const authority = tenant ?? botTenant() ?? "botframework.com";
  try {
    const body = new URLSearchParams({ grant_type: "client_credentials", client_id: appId, client_secret: appPassword, scope });
    const res = await fetch(`https://login.microsoftonline.com/${authority}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    const j = await res.json();
    return j?.access_token ?? null;
  } catch {
    return null;
  }
}

/** Post a text reply back to the conversation via the incoming activity's serviceUrl. */
export async function postTeamsReply(appId: string, appPassword: string, serviceUrl: string, conversationId: string, text: string): Promise<boolean> {
  const tok = await appToken(appId, appPassword, "https://api.botframework.com/.default");
  if (!tok) return false;
  try {
    const url = `${serviceUrl.replace(/\/$/, "")}/v3/conversations/${encodeURIComponent(conversationId)}/activities`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${tok}` },
      body: JSON.stringify({ type: "message", text }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Post any activity (used for Adaptive Cards). postTeamsReply is the text case. */
// deno-lint-ignore no-explicit-any
export async function postTeamsActivity(appId: string, appPassword: string, serviceUrl: string, conversationId: string, activity: any): Promise<boolean> {
  const tok = await appToken(appId, appPassword, "https://api.botframework.com/.default");
  if (!tok) return false;
  try {
    const url = `${serviceUrl.replace(/\/$/, "")}/v3/conversations/${encodeURIComponent(conversationId)}/activities`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${tok}` },
      body: JSON.stringify(activity),
    });
    if (!res.ok) console.warn(`[teams] post activity ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.ok;
  } catch (e) {
    console.warn(`[teams] post activity: ${(e as Error)?.message ?? e}`);
    return false;
  }
}

/** Best-effort email for a Teams user via Graph (needs User.Read.All app permission). */
/**
 * Why a directory lookup failed, when it did.
 *
 * "consent" is the one that matters and the one that used to be invisible: the
 * organisation has installed the app but nobody has approved it, so every person
 * arrives anonymous and the console shows a working assistant that cannot tell
 * anyone apart. That reads as a product fault and is a two-minute fix, so it has
 * to be distinguishable from a network blip.
 */
export type GraphEmailResult =
  | { email: string | null; problem?: undefined }
  | { email: null; problem: "consent" | "unreachable" };

export async function graphEmailDetailed(
  appId: string, appPassword: string, tenantId: string, aadObjectId: string,
): Promise<GraphEmailResult> {
  if (!tenantId || !aadObjectId) return { email: null };
  const tok = await appToken(appId, appPassword, "https://graph.microsoft.com/.default", tenantId);
  // No app token for this tenant at all is the signature of an unconsented
  // organisation: the application permission has never been granted there.
  if (!tok) return { email: null, problem: "consent" };
  try {
    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(aadObjectId)}?$select=mail,userPrincipalName`, {
      headers: { authorization: `Bearer ${tok}` },
    });
    if (res.status === 401 || res.status === 403) {
      console.warn(`[teams] directory lookup refused in tenant ${tenantId} — admin consent not granted`);
      return { email: null, problem: "consent" };
    }
    if (!res.ok) return { email: null, problem: "unreachable" };
    const j = await res.json();
    return { email: j?.mail ?? j?.userPrincipalName ?? null };
  } catch {
    return { email: null, problem: "unreachable" };
  }
}

/** Back-compatible shape for callers that only want the address. */
export async function graphEmail(appId: string, appPassword: string, tenantId: string, aadObjectId: string): Promise<string | null> {
  return (await graphEmailDetailed(appId, appPassword, tenantId, aadObjectId)).email;
}
