// A verifiable statement of who is asking.
//
// On the web embed we forward the host's own signed token, so their API verifies
// its own signature and delegation is real. Teams and Slack hand us an identity
// but no token, so the best we could previously do was send an email address and
// ask the API to trust us. Anything that could reach the endpoint could then
// claim to be anyone.
//
// This signs the claim instead. The API verifies with a secret only it and this
// assistant hold, so it can trust the subject rather than the caller.
//
// Three properties that matter, and why:
//   • Sixty second lifetime. An assertion is for one call. A leaked one is
//     useless almost immediately, which is what makes it safe to put in a header
//     travelling to a third party.
//   • It names the channel that proved the identity. An API can decide it trusts
//     "verified by Microsoft Entra in tenant X" more than a web-embed token, and
//     nothing else tells it that.
//   • It names the assistant. One secret per assistant means a compromised
//     integration cannot speak for another one.
//
// The model never sees any of this: the value is minted in the executor, from a
// server-verified identity, and put straight into a header.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Store } from "./types.ts";
import type { Visitor } from "./httptool.ts";

const TTL_SECONDS = 60;

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlText(s: string): string {
  return b64url(new TextEncoder().encode(s));
}

/** Fetch this assistant's signing key, creating one the first time it is needed.
 *  Generated server-side so a weak key is not a thing anyone can choose. */
export async function getOrCreateAssertionSecret(db: SupabaseClient, storeId: string): Promise<string | null> {
  try {
    const { data } = await db.from("stores").select("assertion_secret").eq("id", storeId).maybeSingle();
    const existing = (data as { assertion_secret?: string | null } | null)?.assertion_secret;
    if (existing) return existing;

    const raw = new Uint8Array(32);
    crypto.getRandomValues(raw);
    const secret = b64url(raw);
    const { error } = await db.from("stores").update({ assertion_secret: secret }).eq("id", storeId);
    if (error) {
      console.warn(`[assertion] could not store a secret: ${error.message}`);
      return null;
    }
    return secret;
  } catch (e) {
    console.warn(`[assertion] secret lookup failed: ${(e as Error)?.message ?? e}`);
    return null;
  }
}

/**
 * Mint a short-lived HS256 assertion for this person.
 *
 * Returns null when there is nothing to assert. A missing assertion must read as
 * "we cannot say who this is", never as an unsigned or partly-filled claim, so
 * the executor declines the call rather than sending something weaker than it
 * looks.
 */
export async function mintAssertion(
  db: SupabaseClient,
  store: Store,
  visitor: Visitor | undefined,
): Promise<string | null> {
  const subject = visitor?.email || visitor?.sub;
  if (!subject) return null;

  const secret = await getOrCreateAssertionSecret(db, store.id);
  if (!secret) return null;

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    iss: "the-assistant",
    sub: subject,
    email: visitor?.email ?? undefined,
    // How the identity was established, so the receiving API can weigh it.
    channel: visitor?.channel ?? "web",
    // Which assistant is asking. One key per assistant, so a compromised
    // integration cannot speak on behalf of a different one.
    assistant: store.slug,
    iat: now,
    exp: now + TTL_SECONDS,
  };

  try {
    const signingInput = `${b64urlText(JSON.stringify(header))}.${b64urlText(JSON.stringify(payload))}`;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput));
    return `${signingInput}.${b64url(new Uint8Array(sig))}`;
  } catch (e) {
    console.warn(`[assertion] sign failed: ${(e as Error)?.message ?? e}`);
    return null;
  }
}
