import { log } from '@/lib/logger';
import { getDocumentQueueHealth } from '@/lib/queue';

export const runtime = 'nodejs';

export async function GET() {
    try {
        const health = await getDocumentQueueHealth();
        log.event('queue-health', 'checked', health);

        return Response.json({
            ok: health.workerCount > 0,
            ...health,
        });
    } catch (err) {
        log.error('queue-health', 'check failed', err);

        return Response.json(
            {
                ok: false,
                message: err instanceof Error ? err.message : 'Queue health check failed',
            },
            { status: 500 },
        );
    }
}
