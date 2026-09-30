import { handleVoiceStatus, type VoiceStatusDependencies } from '@/lib/voice-status';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function GET(
    _req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;

    return handleVoiceStatus(id, {
        createSupabaseClient: async () =>
            (await createClient()) as unknown as Awaited<
                ReturnType<VoiceStatusDependencies['createSupabaseClient']>
            >,
    });
}
