import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The signed-in owner's OWN assistant, for the preview bubble in the console.
 *
 * This replaces a hardcoded demo store from the product this was carved out of:
 * that key belonged to another deployment's database, so the bubble silently never
 * appeared here. Pointing it at the owner's own assistant is both what works and
 * what is actually useful — the fastest way to see what you just changed is to ask
 * it, in the console, without installing anything anywhere.
 *
 * Identity is optional. When the assistant has an SSO secret, the console mints a
 * token so the chat runs AS the signed-in person (which is what makes an
 * identity-forwarding tool testable). Without one the bubble still opens; it just
 * does not know who is asking.
 */
export type OwnAssistant = {
  publishableKey: string;
  identitySecret: string | null;
};

export async function getOwnAssistant(storeId: string): Promise<OwnAssistant | null> {
  const db = createAdminClient();
  const [{ data: tok }, { data: store }] = await Promise.all([
    db
      .from("store_tokens")
      .select("token")
      .eq("store_id", storeId)
      .eq("active", true)
      .like("token", "pk_live_%")
      .order("created_at", { ascending: false })
      .limit(1),
    db.from("stores").select("identity_secret").eq("id", storeId).maybeSingle(),
  ]);
  const key = (tok ?? [])[0]?.token as string | undefined;
  // No key yet means the owner has not opened Embed & install, which is where one
  // is minted. Don't mint from a layout — a page render should not create
  // credentials as a side effect.
  if (!key) return null;
  return {
    publishableKey: key,
    identitySecret: (store as { identity_secret?: string | null } | null)?.identity_secret ?? null,
  };
}
