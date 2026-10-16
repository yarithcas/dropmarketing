import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env, features } from "./env";

/** Per-request Supabase client bound to the user's auth cookies (RLS applies). */
export async function supabaseForRequest(): Promise<SupabaseClient | null> {
  if (!features().supabase) return null;
  const store = await cookies();
  return createServerClient(env.supabaseUrl!, env.supabaseAnonKey!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Called from a Server Component: middleware refreshes the session instead.
        }
      },
    },
  });
}

/** Service-role client for background jobs and webhooks only. Never use it with user input as the identity. */
export function supabaseAdmin(): SupabaseClient | null {
  if (!features().supabaseAdmin) return null;
  return createClient(env.supabaseUrl!, env.supabaseServiceRoleKey!, { auth: { persistSession: false } });
}
