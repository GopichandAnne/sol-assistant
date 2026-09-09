import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

/**
 * A server-side Supabase client with NO session — the anon key and nothing else.
 *
 * The signed-in server client reads auth cookies, which forces the route dynamic
 * against a user who does not exist on a public page. The embed has no user: it
 * resolves an assistant from a publishable key through a SECURITY DEFINER
 * function, and everything it can reach is what that function chooses to return.
 */
export function createAnonClient() {
  return createSupabaseClient<Database>(
    process.env.SUPABASE_INTERNAL_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
