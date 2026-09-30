import { logSession } from './logger';

type SupabaseError = { message: string };

type SupabaseUser = { id: string };

type CreateSupabaseClientLike = {
    auth: {
        getUser(): Promise<{
            data: { user: SupabaseUser | null };
            error?: SupabaseError | null;
        }>;
    };
    from(table: string): {
        insert(row: Record<string, unknown>): PromiseLike<{ error: SupabaseError | null }>;
    };
};

export type CreateSessionDeps = {
    createSupabaseClient(): Promise<CreateSupabaseClientLike>;
    generateSessionId(): string;
};

export async function handleSessionCreate(req: Request, deps: CreateSessionDeps) {
    const startedAt = Date.now();
    logSession.event('create', 'request received');

    let body: unknown;
    try {
        body = await req.json();
    } catch {
        logSession.event('create', 'invalid JSON body');
        return Response.json({ message: 'Invalid request body' }, { status: 400 });
    }

    const documentIds = (body as Record<string, unknown>)?.documentIds;
    if (!Array.isArray(documentIds) || documentIds.length === 0) {
        logSession.event('create', 'missing or empty documentIds');
        return Response.json(
            { message: 'documentIds must be a non-empty array' },
            { status: 400 },
        );
    }

    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!documentIds.every((id) => typeof id === 'string' && UUID_RE.test(id))) {
        logSession.event('create', 'invalid documentIds format');
        return Response.json(
            { message: 'documentIds must be valid UUIDs' },
            { status: 400 },
        );
    }

    const supabase = await deps.createSupabaseClient();
    const {
        data: { user },
        error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
        logSession.event('create', 'unauthorized request', {
            hasAuthError: Boolean(authError),
            hasUser: Boolean(user),
        });
        return Response.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const sessionId = deps.generateSessionId();

    logSession.event('create', 'creating session', {
        sessionId,
        userId: user.id,
        documentCount: documentIds.length,
    });

    const { error: insertError } = await supabase.from('sessions').insert({
        session_id: sessionId,
        user_id: user.id,
        document_ids: documentIds,
    });

    if (insertError) {
        logSession.error('create', 'session insert failed', insertError, {
            sessionId,
            userId: user.id,
            elapsedMs: Date.now() - startedAt,
        });
        return Response.json({ message: insertError.message }, { status: 500 });
    }

    logSession.event('create', 'session created', {
        sessionId,
        userId: user.id,
        documentCount: documentIds.length,
        elapsedMs: Date.now() - startedAt,
    });

    return Response.json({ sessionId }, { status: 201 });
}