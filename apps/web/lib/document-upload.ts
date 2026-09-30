import { logDocument } from './logger';
import type { DocumentJobData } from './queue';

type SupabaseError = {
    message: string;
};

type SupabaseUser = {
    id: string;
};

type SupabaseSession = {
    access_token: string;
};

type SupabaseResult = {
    error?: SupabaseError | null;
};

type SupabaseClientLike = {
    auth: {
        getUser(): Promise<{
            data: { user: SupabaseUser | null };
            error?: SupabaseError | null;
        }>;
        getSession(): Promise<{
            data: { session: SupabaseSession | null };
        }>;
    };
    from(table: string): {
        insert(row: Record<string, unknown>): PromiseLike<SupabaseResult>;
        update(row: Record<string, unknown>): {
            eq(column: string, value: string): PromiseLike<SupabaseResult>;
        };
    };
};

type DocumentQueueLike = {
    add(name: string, data: DocumentJobData): Promise<{ id?: string }>;
};

type QueueHealth = {
    jobCounts: Record<string, number>;
    workerCount: number;
};

export type UploadDependencies = {
    createSupabaseClient(): Promise<SupabaseClientLike>;
    getDocumentQueue(): DocumentQueueLike;
    getDocumentQueueHealth(): Promise<QueueHealth>;
    generateDocumentId(): string;
};

export async function handleDocumentUpload(
    req: Request,
    deps: UploadDependencies,
) {
    const startedAt = Date.now();
    let documentId: string | undefined;

    try {
        logDocument.event('upload', 'request received', {
            contentType: req.headers.get('content-type'),
            contentLength: req.headers.get('content-length'),
        });

        const supabase = await deps.createSupabaseClient();
        const {
            data: { user },
            error: authError,
        } = await supabase.auth.getUser();
        const {
            data: { session },
        } = await supabase.auth.getSession();

        if (authError || !user || !session?.access_token) {
            logDocument.event('upload', 'unauthorized request', {
                hasAuthError: Boolean(authError),
                hasUser: Boolean(user),
                hasSession: Boolean(session),
            });
            return Response.json({ message: 'Unauthorized' }, { status: 401 });
        }

        logDocument.event('upload', 'authenticated user', {
            userId: user.id,
        });

        const formData = await req.formData();
        const file = formData.get('file') as File | null;

        if (!file) {
            logDocument.event('upload', 'missing file');
            return Response.json({ message: 'No file provided' }, { status: 400 });
        }

        documentId = deps.generateDocumentId();
        logDocument.event('upload', 'file received', {
            documentId,
            fileName: file.name,
            fileSize: file.size,
            fileType: file.type,
        });

        const buffer = Buffer.from(await file.arrayBuffer());
        logDocument.event('upload', 'file buffered', {
            documentId,
            bufferBytes: buffer.byteLength,
        });

        const { error: insertError } = await supabase.from('documents').insert({
            document_id: documentId,
            user_id: user.id,
            title: file.name,
            file_type: file.type || 'application/octet-stream',
            parse_status: 'pending',
        });

        if (insertError) {
            logDocument.error('upload', 'document insert failed', insertError, {
                documentId,
                userId: user.id,
            });
            throw new Error(`createDocument failed: ${insertError.message}`);
        }

        logDocument.event('upload', 'document row created', {
            documentId,
            elapsedMs: Date.now() - startedAt,
        });

        try {
            const job = await deps.getDocumentQueue().add('process-document', {
                documentId,
                fileBase64: buffer.toString('base64'),
                fileName: file.name,
                fileType: file.type || 'application/octet-stream',
                userAccessToken: session.access_token,
                userId: user.id,
            });

            logDocument.event('upload', 'job enqueued', {
                documentId,
                jobId: job.id,
                elapsedMs: Date.now() - startedAt,
            });

            const queueHealth = await deps.getDocumentQueueHealth();
            logDocument.event('upload', 'queue health after enqueue', {
                documentId,
                jobId: job.id,
                workerCount: queueHealth.workerCount,
                jobCounts: queueHealth.jobCounts,
            });
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to enqueue document';
            logDocument.error('upload', 'job enqueue failed', err, {
                documentId,
            });

            await supabase
                .from('documents')
                .update({ parse_status: 'failed', error_message: msg })
                .eq('document_id', documentId);
            throw err;
        }

        logDocument.event('upload', 'response sent', {
            documentId,
            elapsedMs: Date.now() - startedAt,
        });

        return Response.json({ documentId });
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Upload failed';
        logDocument.error('upload', 'request failed', err, {
            documentId,
            elapsedMs: Date.now() - startedAt,
        });
        return Response.json({ message: msg }, { status: 500 });
    }
}
