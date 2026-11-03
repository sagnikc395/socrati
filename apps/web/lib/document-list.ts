import { log } from './logger';

type SupabaseError = {
    message: string;
};

type SupabaseUser = {
    id: string;
};

export type DocumentRow = {
    document_id: string;
    title: string;
    file_type: string;
    parse_status: string;
    uploaded_at: string;
};

type QueryResult = PromiseLike<{
    data: DocumentRow[] | null;
    error: SupabaseError | null;
}>;

type ListSupabaseClientLike = {
    auth: {
        getUser(): Promise<{
            data: { user: SupabaseUser | null };
            error?: SupabaseError | null;
        }>;
    };
    from(table: string): {
        select(columns: string): {
            order(column: string, options: { ascending: boolean }): QueryResult;
        };
    };
};

export type ListDependencies = {
    createSupabaseClient(): Promise<ListSupabaseClientLike>;
};

export async function handleDocumentList(
    _req: Request,
    deps: ListDependencies,
) {
    const startedAt = Date.now();

    log.event('list', 'request received');

    const supabase = await deps.createSupabaseClient();
    const {
        data: { user },
        error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
        log.event('list', 'unauthorized request', {
            hasAuthError: Boolean(authError),
            hasUser: Boolean(user),
            elapsedMs: Date.now() - startedAt,
        });
        return Response.json({ message: 'Unauthorized' }, { status: 401 });
    }

    log.event('list', 'fetching documents', { userId: user.id });

    const { data: documents, error: queryError } = await supabase
        .from('documents')
        .select('document_id, title, file_type, parse_status, uploaded_at')
        .order('uploaded_at', { ascending: false });

    if (queryError) {
        log.error('list', 'query failed', queryError, {
            userId: user.id,
            elapsedMs: Date.now() - startedAt,
        });
        return Response.json({ message: queryError.message }, { status: 500 });
    }

    const docs = documents ?? [];
    const statusCounts = docs.reduce<Record<string, number>>((acc, doc) => {
        acc[doc.parse_status] = (acc[doc.parse_status] ?? 0) + 1;
        return acc;
    }, {});

    log.event('list', 'documents fetched', {
        userId: user.id,
        count: docs.length,
        statusCounts,
        elapsedMs: Date.now() - startedAt,
    });

    return Response.json({ documents: docs });
}
