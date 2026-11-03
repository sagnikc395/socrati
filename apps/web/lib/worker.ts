import { Worker } from 'bullmq';
import { chunkDocument } from './chunker';
import { log } from './logger';
import { embedChunksWithReuse } from './embedder';
import { loadEnvFiles } from './load-env';
import { parsePDFFromBuffer } from './parser';
import type { DocumentJobData } from './queue';
import { createRedisConnection } from './redis';
import { getEmbeddingsByHash, saveChunks, updateParseStatus } from './repository';
import { startVoiceWorker } from './voice-worker';

loadEnvFiles();

const worker = new Worker<DocumentJobData>(
    'document-processing',
    async (job) => {
        const { documentId, fileBase64 } = job.data;
        const startedAt = Date.now();
        let parseDoneAt = startedAt;
        let embedDoneAt = startedAt;

        log.event('worker', 'job started', {
            documentId,
            jobId: job.id,
            attempt: job.attemptsMade + 1,
            fileName: job.data.fileName,
            fileType: job.data.fileType,
            base64Length: fileBase64.length,
        });

        log.event('worker', 'marking processing', { documentId, jobId: job.id });
        await updateParseStatus(documentId, 'processing');

        const buffer = Buffer.from(fileBase64, 'base64');
        log.event('worker', 'file decoded', {
            documentId,
            jobId: job.id,
            bufferBytes: buffer.byteLength,
        });

        const doc = await parsePDFFromBuffer(buffer);
        parseDoneAt = Date.now();
        log.event('worker', 'pdf parsed', {
            documentId,
            jobId: job.id,
            textLength: doc.text.length,
            headingCount: doc.headings.length,
            elapsedMs: Date.now() - startedAt,
        });

        const chunks = await chunkDocument(doc);
        log.event('worker', 'document chunked', {
            documentId,
            jobId: job.id,
            chunkCount: chunks.length,
            elapsedMs: Date.now() - startedAt,
        });

        // Embedding reuse: chunks whose sha256 content hash matches an existing
        // row keep the stored embedding — re-uploads make 0 embedding calls.
        const cached = await getEmbeddingsByHash(documentId);
        const { embedded, reused } = await embedChunksWithReuse(chunks, cached);
        log.event('worker', 'chunks embedded', {
            documentId,
            jobId: job.id,
            embeddedCount: embedded.length,
            reusedCount: reused,
            embeddingDimensions: embedded[0]?.embedding.length ?? 0,
            elapsedMs: Date.now() - startedAt,
        });

        await saveChunks(documentId, embedded);
        embedDoneAt = Date.now();
        log.event('worker', 'chunks saved', {
            documentId,
            jobId: job.id,
            chunkCount: embedded.length,
            elapsedMs: Date.now() - startedAt,
        });

        await updateParseStatus(documentId, 'ready');

        log.event('worker', 'ingestion summary', {
            jobId: job.id,
            documentId,
            file_type: job.data.fileType,
            upload_to_ready_ms: Date.now() - startedAt,
            parse_ms: parseDoneAt - startedAt,
            embed_ms: embedDoneAt - parseDoneAt,
            chunk_count: embedded.length,
            embeddings_reused: reused,
        });

        return {
            documentId,
            chunks: embedded.length,
        };
    },
    {
        connection: createRedisConnection(),
        concurrency: Number(process.env.DOCUMENT_WORKER_CONCURRENCY ?? 3),
    },
);

worker.on('active', (job) => {
    log.event('worker', 'job active', {
        documentId: job.data.documentId,
        jobId: job.id,
        attemptsMade: job.attemptsMade,
    });
});

worker.on('completed', (job, result) => {
    log.event('worker', 'job completed event', {
        documentId: result.documentId,
        jobId: job.id,
        chunkCount: result.chunks,
    });
});

worker.on('failed', async (job, err) => {
    const documentId = job?.data.documentId;
    log.error('worker', 'job failed event', err, {
        documentId,
        jobId: job?.id,
        attemptsMade: job?.attemptsMade,
        configuredAttempts: job?.opts.attempts,
    });

    if (!documentId) return;
    if (job.attemptsMade < (job.opts.attempts ?? 1)) return;

    try {
        await updateParseStatus(documentId, 'failed', err.message);
    } catch (statusError) {
        log.error('worker', 'failed to mark document failed', statusError, {
            documentId,
            jobId: job.id,
        });
    }
});

worker.on('error', (err) => {
    log.error('worker', 'worker error event', err);
});

// Phase 3: second Worker in the same process (voice-processing queue).
const voiceWorker = startVoiceWorker();

const shutdown = async () => {
    log.event('worker', 'shutdown requested');
    await Promise.all([worker.close(), voiceWorker.close()]);
    process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

log.event('worker', 'started', {
    concurrency: Number(process.env.DOCUMENT_WORKER_CONCURRENCY ?? 3),
    embeddingMock: process.env.EMBEDDING_MOCK === 'true',
});
