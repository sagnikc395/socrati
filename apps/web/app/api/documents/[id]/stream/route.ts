import { NextRequest } from 'next/server';
import { logDocument } from '@/lib/logger';
import { getDocumentQueueHealth } from '@/lib/queue';
import { createClient } from '@/lib/supabase/server';

type ParseStatus = 'pending' | 'processing' | 'ready' | 'failed';

export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id: documentId } = await params;
    const supabase = await createClient();
    let pollCount = 0;
    let interval: ReturnType<typeof setInterval> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let closed = false;

    const stream = new ReadableStream({
        start(controller) {
            const encoder = new TextEncoder();

            controller.enqueue(encoder.encode(': connected\n\n'));

            const sendAndClose = (status: 'ready' | 'failed', error?: string) => {
                if (closed) return;
                closed = true;
                if (interval) clearInterval(interval);
                if (timeout) clearTimeout(timeout);

                logDocument.event('stream', 'closing stream', {
                    documentId,
                    status,
                    error,
                    pollCount,
                });

                const data = JSON.stringify({ status, ...(error ? { error } : {}) });
                controller.enqueue(encoder.encode(`data: ${data}\n\n`));
                controller.close();
            };

            const poll = async () => {
                try {
                    pollCount += 1;
                    const { data, error } = await supabase
                        .from('documents')
                        .select('parse_status, error_message')
                        .eq('document_id', documentId)
                        .single();

                    if (error) {
                        logDocument.error('stream', 'status poll failed', error, {
                            documentId,
                            pollCount,
                        });
                        sendAndClose('failed', error.message);
                        return;
                    }

                    const status = data.parse_status as ParseStatus;
                    logDocument.event('stream', 'status polled', {
                        documentId,
                        status,
                        pollCount,
                    });

                    if (status === 'pending' && pollCount >= 15) {
                        const health = await getDocumentQueueHealth();
                        logDocument.event('stream', 'pending queue health checked', {
                            documentId,
                            pollCount,
                            workerCount: health.workerCount,
                            jobCounts: health.jobCounts,
                        });

                        if (health.workerCount === 0) {
                            const message =
                                'Document worker is not connected. Start it with `npm run worker -w apps/web`.';

                            await supabase
                                .from('documents')
                                .update({
                                    parse_status: 'failed',
                                    error_message: message,
                                })
                                .eq('document_id', documentId);

                            sendAndClose('failed', message);
                        }
                    }

                    if (status === 'ready') {
                        sendAndClose('ready');
                    }

                    if (status === 'failed') {
                        sendAndClose('failed', data.error_message ?? 'Processing failed');
                    }
                } catch (err) {
                    const msg = err instanceof Error ? err.message : 'Status check failed';
                    logDocument.error('stream', 'status poll threw', err, {
                        documentId,
                        pollCount,
                    });
                    sendAndClose('failed', msg);
                }
            };

            timeout = setTimeout(() => {
                logDocument.event('stream', 'stream timed out', {
                    documentId,
                    pollCount,
                });
                sendAndClose('failed', 'Processing timed out');
            }, 5 * 60 * 1000);

            interval = setInterval(poll, 2_000);
            void poll();
        },
        cancel() {
            closed = true;
            if (interval) clearInterval(interval);
            if (timeout) clearTimeout(timeout);
            logDocument.event('stream', 'client disconnected', {
                documentId,
                pollCount,
            });
        },
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        },
    });
}
