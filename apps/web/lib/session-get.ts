import { logSession } from './logger';

type SupabaseError = { message: string; code?: string };

type SupabaseUser = { id: string };

export type SessionRow = {
    session_id: string;
    user_id: string;
    document_ids: string[];
    created_at: string;
};

export type MessageRow = {
    message_id: string;
    role: string;
    content: string;
    created_at: string;
};

export type SessionDocumentRow = {
    document_id: string;
    title: string;
    file_type: string;
    parse_status: string;
};

type SessionQueryResult = PromiseLike<{
    data: SessionRow | null;
    error: SupabaseError | null;
}>;

type DocumentsQueryResult = PromiseLike<{
    data: SessionDocumentRow[] | null;
    error: SupabaseError | null;
}>;

type GetSupabaseClientLike = {
    auth: {
        getUser(): Promise<{
            data: { user: SupabaseUser | null };
            error?: SupabaseError | null;
        }>;
    };
    from(table: string): {
        select(columns: string): {
            eq(column: string, value: string): {
                single(): SessionQueryResult;
            };
            in(column: string, values: string[]): DocumentsQueryResult;
        };
    };
};

export type GetSessionDeps = {
    createSupabaseClient(): Promise<GetSupabaseClientLike>;
};

export async function handleSessionGet(
    _req: Request,
    sessionId: string,
    deps: GetSessionDeps,
) {
    const startedAt = Date.now();
    logSession.event('get', 'request received', { sessionId });

    const supabase = await deps.createSupabaseClient();
    const {
        data: { user },
        error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
        logSession.event('get', 'unauthorized request', {
            sessionId,
            hasAuthError: Boolean(authError),
        });
        return Response.json({ message: 'Unauthorized' }, { status: 401 });
    }

    logSession.event('get', 'fetching session', { sessionId, userId: user.id });

    const { data: session, error: sessionError } = await supabase
        .from('sessions')
        .select('session_id, user_id, document_ids, created_at')
        .eq('session_id', sessionId)
        .single();

    if (sessionError) {
        // PGRST116 = no rows found with .single() — treat as 404
        if (sessionError.code === 'PGRST116') {
            logSession.event('get', 'session not found', { sessionId });
            return Response.json({ message: 'Session not found' }, { status: 404 });
        }
        logSession.error('get', 'session query failed', sessionError, { sessionId });
        return Response.json({ message: sessionError.message }, { status: 500 });
    }

    if (!session) {
        logSession.event('get', 'session not found', { sessionId });
        return Response.json({ message: 'Session not found' }, { status: 404 });
    }

    if (session.document_ids.length === 0) {
        logSession.event('get', 'session has no documents', { sessionId });
        return Response.json({ session, documents: [] });
    }

    logSession.event('get', 'fetching session documents', {
        sessionId,
        documentCount: session.document_ids.length,
    });

    const { data: documents, error: docsError } = await supabase
        .from('documents')
        .select('document_id, title, file_type, parse_status')
        .in('document_id', session.document_ids);

    if (docsError) {
        logSession.error('get', 'documents query failed', docsError, {
            sessionId,
            documentCount: session.document_ids.length,
        });
        return Response.json({ message: docsError.message }, { status: 500 });
    }

    logSession.event('get', 'fetching session messages', { sessionId });

    // Using `any` cast to avoid complex Supabase type instantiation limits in this helper
    const { data: messages, error: messagesError } = await (supabase.from('messages') as any)
        .select('message_id, role, content, created_at')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true });

    if (messagesError) {
        logSession.error('get', 'messages query failed', messagesError, { sessionId });
        return Response.json({ message: messagesError.message }, { status: 500 });
    }

    logSession.event('get', 'session fetched', {
        sessionId,
        userId: user.id,
        documentCount: documents?.length ?? 0,
        messageCount: messages?.length ?? 0,
        elapsedMs: Date.now() - startedAt,
    });

    return Response.json({ session, documents: documents ?? [], messages: messages ?? [] });
}