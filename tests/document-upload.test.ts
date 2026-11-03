import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import { handleDocumentUpload, type UploadDependencies } from '../apps/web/lib/document-upload';

type InsertRow = Record<string, unknown>;
type UpdateRow = {
    table: string;
    row: Record<string, unknown>;
    column: string;
    value: string;
};

const originalConsole = {
    log: console.log,
    error: console.error,
};

before(() => {
    console.log = () => {};
    console.error = () => {};
});

after(() => {
    console.log = originalConsole.log;
    console.error = originalConsole.error;
});

function createUploadRequest(file?: File) {
    const formData = new FormData();
    if (file) {
        formData.append('file', file);
    }

    return new Request('http://localhost/api/documents/upload', {
        method: 'POST',
        body: formData,
    });
}

function createPdfFile(content = 'hello pdf') {
    return new File([content], 'notes.pdf', {
        type: 'application/pdf',
    });
}

function createDeps(options?: {
    authError?: { message: string } | null;
    user?: { id: string } | null;
    insertError?: { message: string } | null;
    enqueueError?: Error;
}) {
    const inserts: InsertRow[] = [];
    const updates: UpdateRow[] = [];
    const jobs: Array<{ name: string; data: unknown }> = [];
    let healthChecks = 0;

    const deps: UploadDependencies = {
        async createSupabaseClient() {
            return {
                auth: {
                    async getUser() {
                        return {
                            data: {
                                user:
                                    options && 'user' in options
                                        ? options.user!
                                        : { id: 'user-123' },
                            },
                            error: options?.authError ?? null,
                        };
                    },
                },
                from(table: string) {
                    return {
                        async insert(row: Record<string, unknown>) {
                            inserts.push({ table, ...row });
                            return { error: options?.insertError ?? null };
                        },
                        update(row: Record<string, unknown>) {
                            return {
                                async eq(column: string, value: string) {
                                    updates.push({ table, row, column, value });
                                    return { error: null };
                                },
                            };
                        },
                    };
                },
            };
        },
        getDocumentQueue() {
            return {
                async add(name, data) {
                    if (options?.enqueueError) {
                        throw options.enqueueError;
                    }

                    jobs.push({ name, data });
                    return { id: 'job-123' };
                },
            };
        },
        async getDocumentQueueHealth() {
            healthChecks += 1;
            return {
                jobCounts: {
                    waiting: 1,
                    active: 0,
                },
                workerCount: 1,
            };
        },
        generateDocumentId() {
            return 'document-123';
        },
    };

    return {
        deps,
        inserts,
        updates,
        jobs,
        get healthChecks() {
            return healthChecks;
        },
    };
}

async function readJson(response: Response) {
    return (await response.json()) as Record<string, unknown>;
}

describe('document upload handler', () => {
    it('creates a pending document row and enqueues a processing job', async () => {
        const fixture = createDeps();
        const response = await handleDocumentUpload(
            createUploadRequest(createPdfFile('course notes')),
            fixture.deps,
        );

        assert.equal(response.status, 200);
        assert.deepEqual(await readJson(response), {
            documentId: 'document-123',
        });

        assert.deepEqual(fixture.inserts, [
            {
                table: 'documents',
                document_id: 'document-123',
                user_id: 'user-123',
                title: 'notes.pdf',
                file_type: 'application/pdf',
                parse_status: 'pending',
            },
        ]);

        assert.equal(fixture.jobs.length, 1);
        assert.equal(fixture.jobs[0]?.name, 'process-document');
        assert.deepEqual(fixture.jobs[0]?.data, {
            documentId: 'document-123',
            fileBase64: Buffer.from('course notes').toString('base64'),
            fileName: 'notes.pdf',
            fileType: 'application/pdf',
            userId: 'user-123',
        });
        assert.equal(fixture.healthChecks, 1);
    });

    it('returns unauthorized without inserting or enqueueing when auth is missing', async () => {
        const fixture = createDeps({
            user: null,
        });

        const response = await handleDocumentUpload(
            createUploadRequest(createPdfFile()),
            fixture.deps,
        );

        assert.equal(response.status, 401);
        assert.deepEqual(await readJson(response), {
            message: 'Unauthorized',
        });
        assert.deepEqual(fixture.inserts, []);
        assert.deepEqual(fixture.jobs, []);
    });

    it('returns bad request without inserting or enqueueing when no file is provided', async () => {
        const fixture = createDeps();

        const response = await handleDocumentUpload(createUploadRequest(), fixture.deps);

        assert.equal(response.status, 400);
        assert.deepEqual(await readJson(response), {
            message: 'No file provided',
        });
        assert.deepEqual(fixture.inserts, []);
        assert.deepEqual(fixture.jobs, []);
    });

    it('marks the document failed when enqueueing the job fails', async () => {
        const fixture = createDeps({
            enqueueError: new Error('Redis unavailable'),
        });

        const response = await handleDocumentUpload(
            createUploadRequest(createPdfFile()),
            fixture.deps,
        );

        assert.equal(response.status, 500);
        assert.deepEqual(await readJson(response), {
            message: 'Redis unavailable',
        });
        assert.deepEqual(fixture.updates, [
            {
                table: 'documents',
                row: {
                    parse_status: 'failed',
                    error_message: 'Redis unavailable',
                },
                column: 'document_id',
                value: 'document-123',
            },
        ]);
    });
});
