import { logDocument } from './logger';

type VoiceTurnRow = {
    status: string;
    transcript: string | null;
    reply: string | null;
    error_message: string | null;
};

type SupabaseError = { message: string };

type VoiceStatusSupabaseClient = {
    auth: {
        getUser(): Promise<{
            data: { user: { id: string } | null };
            error?: SupabaseError | null;
        }>;
    };
    from(table: string): {
        select(columns: string): {
            eq(column: string, value: string): {
                maybeSingle(): PromiseLike<{ data: VoiceTurnRow | null; error: SupabaseError | null }>;
            };
        };
    };
};

export type VoiceStatusDependencies = {
    createSupabaseClient(): Promise<VoiceStatusSupabaseClient>;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handleVoiceStatus(
    voiceTurnId: string,
    deps: VoiceStatusDependencies,
) {
    if (!UUID_RE.test(voiceTurnId)) {
        return Response.json({ message: 'voiceTurnId must be a valid UUID' }, { status: 400 });
    }

    const supabase = await deps.createSupabaseClient();
    const {
        data: { user },
        error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
        return Response.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const { data, error } = await supabase
        .from('voice_turns')
        .select('status, transcript, reply, error_message')
        .eq('id', voiceTurnId)
        .maybeSingle();

    if (error) {
        logDocument.error('voice', 'status lookup failed', error, { voiceTurnId });
        return Response.json({ message: error.message }, { status: 500 });
    }

    if (!data) {
        return Response.json({ message: 'Voice turn not found' }, { status: 404 });
    }

    return Response.json({
        status: data.status,
        transcript: data.transcript,
        reply: data.reply,
        errorMessage: data.error_message,
    });
}
