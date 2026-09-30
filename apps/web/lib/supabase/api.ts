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
