'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const MAX_DURATION_MS = 120_000;
const MAX_BYTES = 10 * 1024 * 1024;
const POLL_INTERVAL_MS = 1_500;
const POLL_TIMEOUT_MS = 60_000;

type VoiceTurn = { transcript: string; reply: string };

type RecorderState = 'idle' | 'recording' | 'uploading' | 'processing' | 'error';

const MIME_CANDIDATES = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg',
    'audio/wav',
];

function pickMimeType() {
    if (typeof MediaRecorder === 'undefined') return '';
    return MIME_CANDIDATES.find((mime) => MediaRecorder.isTypeSupported(mime)) ?? '';
}

export function VoiceRecorder({
    sessionId,
    documentIds,
    disabled = false,
    onTurn,
}: {
    sessionId: string;
    documentIds: string[];
    disabled?: boolean;
    onTurn(turn: VoiceTurn): void;
}) {
    const [state, setState] = useState<RecorderState>('idle');
    const [error, setError] = useState<string | null>(null);
    const [elapsedMs, setElapsedMs] = useState(0);

    const recorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const streamRef = useRef<MediaStream | null>(null);
    const startedAtRef = useRef(0);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const cancelledRef = useRef(false);

    const stopTracks = useCallback(() => {
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
    }, []);

    useEffect(() => {
        return () => {
            cancelledRef.current = true;
            if (timerRef.current) clearInterval(timerRef.current);
            if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
            stopTracks();
            window.speechSynthesis?.cancel();
        };
    }, [stopTracks]);

    const speak = useCallback((text: string) => {
        if (typeof window === 'undefined' || !window.speechSynthesis) return;
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1;
        window.speechSynthesis.speak(utterance);
    }, []);

    const upload = useCallback(
        async (blob: Blob, mimeType: string, durationMs: number) => {
            if (blob.size > MAX_BYTES) {
                setError('Recording exceeds the 10 MB limit.');
                setState('error');
                return;
            }

            setState('uploading');
            try {
                const form = new FormData();
                form.append('audio', new File([blob], 'recording.webm', { type: mimeType }));
                form.append('sessionId', sessionId);
                form.append('durationMs', String(Math.round(durationMs)));
                if (documentIds.length > 0) {
                    form.append('documentIds', JSON.stringify(documentIds));
                }

                const res = await fetch('/api/voice', { method: 'POST', body: form });
                if (!res.ok) {
                    const body = (await res.json().catch(() => ({}))) as { message?: string };
                    throw new Error(body.message ?? `Upload failed (${res.status})`);
                }

                const { voiceTurnId } = (await res.json()) as { voiceTurnId: string };
                setState('processing');

                const deadline = Date.now() + POLL_TIMEOUT_MS;
                while (Date.now() < deadline && !cancelledRef.current) {
                    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
                    const poll = await fetch(`/api/voice/${voiceTurnId}`);
                    if (!poll.ok) continue;

                    const turn = (await poll.json()) as {
                        status: string;
                        transcript: string | null;
                        reply: string | null;
                        errorMessage: string | null;
                    };

                    if (turn.status === 'ready' && turn.transcript && turn.reply) {
                        onTurn({ transcript: turn.transcript, reply: turn.reply });
                        speak(turn.reply);
                        setState('idle');
                        return;
                    }

                    if (turn.status === 'failed') {
                        throw new Error(turn.errorMessage ?? 'Voice processing failed.');
                    }
                }

                throw new Error('Timed out waiting for the reply.');
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Voice request failed.');
                setState('error');
            }
        },
        [documentIds, onTurn, sessionId, speak],
    );

    const stopRecording = useCallback(() => {
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = null;
        recorderRef.current?.stop();
    }, []);

    const startRecording = useCallback(async () => {
        setError(null);
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;

            const mimeType = pickMimeType();
            const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
            chunksRef.current = [];
            recorderRef.current = recorder;
            startedAtRef.current = Date.now();

            recorder.ondataavailable = (event) => {
                if (event.data.size > 0) chunksRef.current.push(event.data);
            };

            recorder.onstop = () => {
                const durationMs = Date.now() - startedAtRef.current;
                const type = recorder.mimeType || mimeType || 'audio/webm';
                const blob = new Blob(chunksRef.current, { type });
                stopTracks();
                setElapsedMs(0);

                if (cancelledRef.current) return;
                void upload(blob, type.split(';')[0]!, durationMs);
            };

            recorder.start();
            setState('recording');
            timerRef.current = setInterval(() => {
                const elapsed = Date.now() - startedAtRef.current;
                setElapsedMs(elapsed);
                if (elapsed >= MAX_DURATION_MS) stopRecording();
            }, 200);
        } catch {
            setError('Microphone access was denied.');
            setState('error');
            stopTracks();
        }
    }, [stopRecording, stopTracks, upload]);

    const busy = state === 'uploading' || state === 'processing';
    const recording = state === 'recording';

    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
                type="button"
                onClick={recording ? stopRecording : startRecording}
                disabled={disabled || busy}
                className="btn-chip"
                title={recording ? 'Stop and send' : 'Record a question'}
                style={{
                    width: 34,
                    height: 34,
                    borderRadius: 9,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 0,
                    background: recording ? '#b3453a' : undefined,
                    color: recording ? '#fff' : undefined,
                }}
            >
                {recording ? (
                    <span style={{ width: 10, height: 10, background: '#fff', borderRadius: 2 }} />
                ) : (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                        <path
                            d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Z"
                            stroke="currentColor"
                            strokeWidth="1.6"
                        />
                        <path
                            d="M5 11a7 7 0 0 0 14 0M12 18v3"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                        />
                    </svg>
                )}
            </button>

            {recording && (
                <span style={{ fontSize: 12, color: '#b3453a', whiteSpace: 'nowrap' }}>
                    ● {(elapsedMs / 1000).toFixed(0)}s — tap to send
                </span>
            )}
            {busy && (
                <span style={{ fontSize: 12, color: 'var(--t3)', whiteSpace: 'nowrap' }}>
                    {state === 'uploading' ? 'Uploading…' : 'Transcribing…'}
                </span>
            )}
            {error && (
                <span style={{ fontSize: 12, color: '#8a4a40', whiteSpace: 'nowrap' }}>{error}</span>
            )}
        </div>
    );
}
