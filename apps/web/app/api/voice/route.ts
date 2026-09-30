import { NextRequest } from 'next/server';
import { handleVoiceUpload, type VoiceUploadDependencies } from '@/lib/voice-upload';
import { getVoiceQueue } from '@/lib/voice-queue';
import { checkRateLimit } from '@/lib/redis';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
    return handleVoiceUpload(req, {
        // Cast avoids Supabase's deep generic instantiation on the storage helper
        createSupabaseClient: async () =>
            (await createClient()) as unknown as Awaited<
                ReturnType<VoiceUploadDependencies['createSupabaseClient']>
            >,
        getVoiceQueue,
        checkRateLimit,
        generateVoiceTurnId: crypto.randomUUID,
    });
}
