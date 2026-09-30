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

// ── Rate limiting (Phase 2) ──────────────────────────────────────────────────
// Sliding window over a Redis sorted set — per user, no new service. Uses the
// same connection settings as BullMQ but a dedicated lazy client so chat
// requests don't share state with the queue.

let rateLimitClient: IORedis | undefined;

function getRateLimitClient(): IORedis {
    rateLimitClient ??= new IORedis(getRedisUrl(), {
        connectTimeout: 10_000,
        commandTimeout: 5_000,
        enableReadyCheck: false,
        maxRetriesPerRequest: 1,
    });
    return rateLimitClient;
}

export type RateLimitResult = { allowed: boolean; remaining: number; retryAfterSec: number };

/**
 * Sliding-window rate limit. Returns allowed=false with a retry hint once the
 * user exceeds `limit` requests in the trailing `windowSec`. Fails open —
 * a Redis outage must not take chat down.
 */
export async function checkRateLimit(
    userId: string,
    limit = 30,
    windowSec = 60,
    now = Date.now(),
): Promise<RateLimitResult> {
    try {
        const redis = getRateLimitClient();
        const key = `ratelimit:chat:${userId}`;
        const windowStartMs = now - windowSec * 1000;

        // One round trip: drop old entries, count window, add this request
        const pipeline = redis.multi();
        pipeline.zremrangebyscore(key, '-inf', windowStartMs);
        pipeline.zcard(key);
        const results = await pipeline.exec();
        const count = Number(results?.[1]?.[1] ?? 0);

        if (count >= limit) {
            // Oldest entry in the window = when the slot frees up
            const oldest = await redis.zrange(key, 0, 0, 'WITHSCORES');
            const retryAt = Number(oldest[1] ?? now) + windowSec * 1000;
            return { allowed: false, remaining: 0, retryAfterSec: Math.max(1, Math.ceil((retryAt - now) / 1000)) };
        }

        await redis.zadd(key, now, `${now}-${Math.random().toString(36).slice(2, 8)}`);
        await redis.expire(key, windowSec);
        return { allowed: true, remaining: limit - count - 1, retryAfterSec: 0 };
    } catch (err) {
        logDocument.error('ratelimit', 'check failed — failing open', err, { userId });
        return { allowed: true, remaining: limit, retryAfterSec: 0 };
    }
}

/** Test hook. */
export async function closeRateLimitClient() {
    await rateLimitClient?.quit();
    rateLimitClient = undefined;
}
