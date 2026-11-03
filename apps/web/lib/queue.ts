import { Queue } from 'bullmq';
import { createRedisConnection } from './redis';

export type DocumentJobData = {
    documentId: string;
    fileBase64: string;
    fileName: string;
    fileType: string;
    userId: string;
};

let documentQueue: Queue<DocumentJobData> | undefined;

export function getDocumentQueue() {
    documentQueue ??= new Queue<DocumentJobData>('document-processing', {
        connection: createRedisConnection(),
        defaultJobOptions: {
            attempts: 3,
            backoff: {
                type: 'exponential',
                delay: 5_000,
            },
            removeOnComplete: {
                age: 60 * 60 * 24,
                count: 500,
            },
            removeOnFail: {
                age: 60 * 60 * 24 * 7,
                count: 1_000,
            },
        },
    });

    return documentQueue;
}

export async function getDocumentQueueHealth() {
    const queue = getDocumentQueue();
    const [jobCounts, workers] = await Promise.all([
        queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed', 'paused'),
        queue.getWorkers().catch(() => []),
    ]);

    return {
        jobCounts,
        workerCount: workers.length,
        workers: workers.map((worker) => ({
            id: worker.id,
            name: worker.name,
            addr: worker.addr,
        })),
    };
}
