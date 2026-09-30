import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { generateMindMap } from '@/lib/mindmap';
import { loadEnvFiles } from '@/lib/load-env';
import { logMindMap } from '@/lib/logger';

export async function POST(req: Request) {
    loadEnvFiles();

    const cookieStore = await cookies();
    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { cookies: { getAll: () => cookieStore.getAll() } },
    );

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
        logMindMap.event('route', 'unauthorized request');
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body: unknown;
    try {
        body = await req.json();
    } catch {
        logMindMap.event('route', 'invalid JSON body');
        return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }

    const documentId = (body as Record<string, unknown>)?.documentId;
    if (typeof documentId !== 'string' || documentId.trim().length === 0) {
        logMindMap.event('route', 'missing documentId');
        return NextResponse.json({ error: 'documentId is required.' }, { status: 400 });
    }

    try {
        const result = await generateMindMap({
            documentId: documentId.trim(),
            accessToken: session.access_token,
            userId: session.user?.id,
        });

        return NextResponse.json(result);
    } catch (err) {
        logMindMap.error('route', 'mind map generation failed', err, { documentId });
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Mind map generation failed.' },
            { status: 500 },
        );
    }
}
