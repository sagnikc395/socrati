import { logDocument } from './logger';

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

    logDocument.event('list', 'request received');

    const supabase = await deps.createSupabaseClient();
    const {
        data: { user },
        error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
        logDocument.event('list', 'unauthorized request', {
            hasAuthError: Boolean(authError),
            hasUser: Boolean(user),
            elapsedMs: Date.now() - startedAt,
        });
        return Response.json({ message: 'Unauthorized' }, { status: 401 });
    }

    logDocument.event('list', 'fetching documents', { userId: user.id });

    const { data: documents, error: queryError } = await supabase
        .from('documents')
        .select('document_id, title, file_type, parse_status, uploaded_at')
        .order('uploaded_at', { ascending: false });

    if (queryError) {
        logDocument.error('list', 'query failed', queryError, {
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

    logDocument.event('list', 'documents fetched', {
        userId: user.id,
        count: docs.length,
        statusCounts,
        elapsedMs: Date.now() - startedAt,
    });

    return Response.json({ documents: docs });
}
