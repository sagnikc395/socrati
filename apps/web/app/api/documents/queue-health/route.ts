import { logDocument } from '@/lib/logger';
import { getDocumentQueueHealth } from '@/lib/queue';

export const runtime = 'nodejs';

export async function GET() {
    try {
        const health = await getDocumentQueueHealth();
        logDocument.event('queue-health', 'checked', health);

        return Response.json({
            ok: health.workerCount > 0,
            ...health,
        });
    } catch (err) {
        logDocument.error('queue-health', 'check failed', err);

        return Response.json(
            {
                ok: false,
                message: err instanceof Error ? err.message : 'Queue health check failed',
            },
            { status: 500 },
        );
    }
}
