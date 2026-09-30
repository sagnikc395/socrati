import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnvFiles } from '../load-env';

/**
 * Anon-key Supabase client, RLS-enforced when an accessToken is passed.
 * Shared by rag / quiz / mindmap; server routes that need cookie-based
 * sessions use lib/supabase/server instead.
 */
export function getAnonSupabaseClient(accessToken?: string): SupabaseClient {
    loadEnvFiles();
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

    return createClient(url, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        ...(accessToken && {
            global: { headers: { Authorization: `Bearer ${accessToken}` } },
        }),
    });
}

/**
 * Service-role client — bypasses RLS. Worker-only (Storage download/delete and
 * trusted writes); never expose to a request path that echoes user input.
 */
export function getServiceRoleSupabaseClient(): SupabaseClient {
    loadEnvFiles();
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceRoleKey) {
        throw new Error('SUPABASE_SERVICE_ROLE_KEY is missing — required by the voice worker.');
    }

    return createClient(url, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
    });
}
