import { Queue } from 'bullmq';
import { createRedisConnection } from './redis';

export type VoiceJobData = {
    voiceTurnId: string;
    storagePath: string;
    mimeType: string;
    audioHash: string;
    userId: string;
    sessionId: string;
    documentIds: string[];
    userAccessToken: string;
};

let voiceQueue: Queue<VoiceJobData> | undefined;

/** Same Redis connection + retry policy as the document queue (Phase 2). */
export function getVoiceQueue() {
    voiceQueue ??= new Queue<VoiceJobData>('voice-processing', {
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

    return voiceQueue;
}
