import IORedis from 'ioredis';
import { logDocument } from './logger';
import { loadEnvFiles } from './load-env';

function getRedisUrl() {
    loadEnvFiles();

    const restUrl = process.env.UPSTASH_REDIS_REST_URL;
    const restToken = process.env.UPSTASH_REDIS_REST_TOKEN;
    const url =
        process.env.REDIS_URL ??
        process.env.UPSTASH_REDIS_URL ??
        process.env.UPSTASH_REDIS_CONNECTION_STRING;

    if (!url) {
        if (restUrl || restToken) {
            throw new Error(
                'BullMQ cannot use UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN. Set REDIS_URL to the Upstash Redis protocol URL that starts with rediss://.',
            );
        }

        throw new Error(
            'Redis connection string is missing. Set REDIS_URL to your BullMQ-compatible Redis URL. For Upstash, use the rediss:// Redis URL, not the REST URL/token pair.',
        );
    }

    if (!url.startsWith('redis://') && !url.startsWith('rediss://')) {
        throw new Error(
            'REDIS_URL must start with redis:// or rediss://. For Upstash, copy the Redis protocol URL from the database details page.',
        );
    }

    return url;
}

export function createRedisConnection() {
    const connection = new IORedis(getRedisUrl(), {
        connectTimeout: 10_000,
        commandTimeout: 15_000,
        enableReadyCheck: false,
        maxRetriesPerRequest: null,
    });

    connection.on('connect', () => {
        logDocument.event('redis', 'connect');
    });

    connection.on('ready', () => {
        logDocument.event('redis', 'ready');
    });

    connection.on('error', (err) => {
        logDocument.error('redis', 'connection error', err);
    });

    connection.on('close', () => {
        logDocument.event('redis', 'connection closed');
    });

    connection.on('reconnecting', (delay: number) => {
        logDocument.event('redis', 'reconnecting', { delay });
    });

    return connection;
}
