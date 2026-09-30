'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
// import Sidebar from '../../components/Sidebar';

type ParseStatus = 'uploading' | 'processing' | 'ready' | 'failed';

interface UploadedDoc {
    id: string;
    file?: File;
    name: string;
    sizeMb: string;
    status: ParseStatus;
    documentId?: string;
    errorMsg?: string;
}

const ACCEPTED = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
];
// doubt: change file format, max size per/total file 
const ACCEPTED_EXT = '.pdf,.pptx,.txt';
const MAX_MB = 25;

export default function NewSessionPage() {
    const router = useRouter();
    const [docs, setDocs] = useState<UploadedDoc[]>([]);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [dragging, setDragging] = useState(false);
    const [starting, setStarting] = useState(false);
    const [startError, setStartError] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const updateDoc = (id: string, patch: Partial<UploadedDoc>) =>
        setDocs(prev => prev.map(d => (d.id === id ? { ...d, ...patch } : d)));

    // ── SSE listener ──────────────────────────────────────────────────────────
    // Opens a persistent SSE connection to the backend.
    // Backend emits exactly ONE event when the BullMQ pipeline completes:
    //   data: {"status":"ready"}
    //   data: {"status":"failed","error":"image-only PDF, no text found"}
    // Then the backend closes the stream.
    const listenForStatus = useCallback(
        (localId: string, documentId: string) => {
            const es = new EventSource(`/api/documents/${documentId}/stream`);

            es.onmessage = event => {
                try {
                    const { status, error } = JSON.parse(event.data) as {
                        status: 'ready' | 'failed';
                        error?: string;
                    };
                    if (status === 'ready' || status === 'failed') {
                        updateDoc(localId, { status, errorMsg: error });
                        es.close(); // pipeline done — no more events expected
                    }
                } catch {
                    // malformed event — ignore, keep listening
                }
            };

            es.onerror = () => {
                // Connection dropped before pipeline finished
                updateDoc(localId, { status: 'failed', errorMsg: 'Connection lost' });
                es.close();
            };
        },
        // updateDoc is stable (functional setDocs updater) — no re-subscription needed
        [],
    );

    // ── Load persisted documents on mount ─────────────────────────────────────
    // RLS on the documents table ensures only the authenticated user's rows are returned.
    useEffect(() => {
        fetch('/api/documents')
            .then(res => {
                if (!res.ok) return;
                return res.json() as Promise<{
                    documents: Array<{
                        document_id: string;
                        title: string;
                        parse_status: string;
                        uploaded_at: string;
                    }>;
                }>;
            })
            .then(body => {
                if (!body) return;
                const loaded: UploadedDoc[] = body.documents.map(doc => ({
                    id: doc.document_id,
                    name: doc.title,
                    sizeMb: '-',
                    status: (doc.parse_status === 'ready' || doc.parse_status === 'failed'
                        ? doc.parse_status
                        : 'processing') as ParseStatus,
                    documentId: doc.document_id,
                }));
                setDocs(loaded);
                // Reattach SSE for any doc still in the pipeline so the UI updates when done
                for (const doc of loaded) {
                    if (doc.status === 'processing' && doc.documentId) {
                        listenForStatus(doc.id, doc.documentId);
                    }
                }
            })
            .catch(() => {
                // silently ignore — user can still upload new files
            });
    }, [listenForStatus]);

    // ── File upload ───────────────────────────────────────────────────────────
    const uploadFile = useCallback(
        async (file: File) => {
            if (!ACCEPTED.includes(file.type)) {
                alert(`Unsupported file type: ${file.name}. Please use PDF, PPTX, or TXT.`);
                return;
            }
            if (file.size > MAX_MB * 1024 * 1024) {
                alert(`${file.name} exceeds ${MAX_MB} MB limit.`);
                return;
            }

            const localId = crypto.randomUUID();
            setDocs(prev => [
                ...prev,
                {
                    id: localId,
                    file,
                    name: file.name,
                    sizeMb: (file.size / (1024 * 1024)).toFixed(1),
                    status: 'uploading',
                },
            ]);

            try {
                // Send the raw File object as multipart/form-data.
                // Backend stores the file, creates a documents row, and enqueues
                // a BullMQ job for parse → chunk → embed.
                const formData = new FormData();
                formData.append('file', file);

                const res = await fetch('/api/documents/upload', {
                    method: 'POST',
                    body: formData,
                });

                if (!res.ok) {
                    const err = await res.json().catch(() => ({ message: 'Upload failed' }));
                    updateDoc(localId, { status: 'failed', errorMsg: err.message });
                    return;
                }

                // Backend returns { documentId: string }
                // No parseStatus — the BullMQ job hasn't started yet
                const { documentId } = await res.json() as { documentId: string };
                updateDoc(localId, { status: 'processing', documentId });

                // Open SSE stream — UI updates when the job emits its completion event
                listenForStatus(localId, documentId);
            } catch {
                updateDoc(localId, { status: 'failed', errorMsg: 'Network error' });
            }
        },
        [listenForStatus],
    );

    const handleFiles = (files: FileList | null) => {
        if (!files) return;
        Array.from(files).forEach(uploadFile);
    };

    const toggleSelect = (id: string) => {
        const doc = docs.find(d => d.id === id);
        if (doc?.status !== 'ready') return;
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    const handleStartSession = async () => {
        const selectedDocIds = docs
            .filter(d => selected.has(d.id) && d.documentId)
            .map(d => d.documentId!);
        if (selectedDocIds.length === 0) return;

        setStarting(true);
        setStartError(null);

        try {
            const res = await fetch('/api/sessions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ documentIds: selectedDocIds }),
            });

            if (!res.ok) {
                const body = await res.json().catch(() => ({ message: 'Failed to start session' }));
                setStartError((body as { message?: string }).message ?? 'Failed to start session');
                return;
            }

            const { sessionId } = await res.json() as { sessionId: string };
            router.push(`/sessions/${sessionId}`);
        } catch {
            setStartError('Network error — please try again');
        } finally {
            setStarting(false);
        }
    };

    const readyCount = selected.size;

    return (
        <div style={{ display: 'flex', minHeight: '100vh' }}>
            <Sidebar />
            <main style={{ flex: 1, background: 'var(--main)', display: 'flex', flexDirection: 'column' }}>

                {/* Header */}
                <div style={{ padding: '20px 24px 15px', borderBottom: '1px solid var(--b1)' }}>
                    <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--td)', letterSpacing: '-0.2px' }}>
                        My documents
                    </h1>
                    <p style={{ fontSize: 12, color: 'var(--t3)', marginTop: 3 }}>
                        Upload study materials, then select files to start a session
                    </p>
                </div>

                {/* Body */}
                <div style={{ padding: '20px 24px', flex: 1 }}>

                    {/* Drop zone */}
                    <div
                        onDragOver={e => { e.preventDefault(); setDragging(true); }}
                        onDragLeave={() => setDragging(false)}
                        onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
                        onClick={() => inputRef.current?.click()}
                        style={{
                            border: `1.5px dashed ${dragging ? 'var(--acc)' : 'var(--hintb)'}`,
                            borderRadius: 12,
                            background: dragging ? 'var(--acl)' : 'var(--hint)',
                            padding: '28px 20px',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: 7,
                            marginBottom: 20,
                            cursor: 'pointer',
                            transition: 'all 0.15s',
                        }}
                    >
                        <div style={{
                            width: 40, height: 40, borderRadius: 10, background: 'var(--acl)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 2,
                        }}>
                            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                                <path d="M9 12V4M5 8l4-4 4 4" stroke="#5c8c6e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                <path d="M3 14h12" stroke="#5c8c6e" strokeWidth="1.5" strokeLinecap="round" />
                            </svg>
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--td)' }}>Drop your files here</div>
                        <div style={{ fontSize: 12, color: 'var(--t3)' }}>PDF, PPTX, or TXT · max 25 MB per file</div>
                        <button
                            type="button"
                            style={{
                                marginTop: 4, background: 'var(--acc)', color: '#eef8f2',
                                border: 'none', borderRadius: 99, padding: '6px 18px',
                                fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500,
                            }}
                        >
                            Browse files
                        </button>
                        <input
                            ref={inputRef}
                            type="file"
                            accept={ACCEPTED_EXT}
                            multiple
                            style={{ display: 'none' }}
                            onChange={e => handleFiles(e.target.files)}
                        />
                    </div>

                    {/* Document list */}
                    {docs.length > 0 && (
                        <>
                            <div style={{
                                fontSize: 10, fontWeight: 500, color: 'var(--t3)',
                                letterSpacing: '.07em', textTransform: 'uppercase', marginBottom: 9,
                            }}>
                                Uploaded documents
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                                {docs.map(doc => (
                                    <DocRow
                                        key={doc.id}
                                        doc={doc}
                                        isSelected={selected.has(doc.id)}
                                        onToggle={() => toggleSelect(doc.id)}
                                    />
                                ))}
                            </div>
                        </>
                    )}
                </div>

                {/* Footer — only visible when at least one doc is selected */}
                {readyCount > 0 && (
                    <div style={{
                        padding: '13px 24px',
                        borderTop: '1px solid var(--b1)',
                        background: 'var(--foot)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 12,
                    }}>
                        <div>
                            <span style={{ fontSize: 13, color: 'var(--t2)' }}>
                                {readyCount} document{readyCount !== 1 ? 's' : ''} selected
                            </span>
                            {startError && (
                                <span style={{ fontSize: 12, color: '#8a4a40', marginLeft: 10 }}>
                                    {startError}
                                </span>
                            )}
                        </div>
                        <button
                            onClick={handleStartSession}
                            disabled={starting}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 7,
                                background: starting ? 'var(--hintb)' : 'var(--acc)',
                                color: starting ? 'var(--t3)' : '#eef8f2',
                                border: 'none', borderRadius: 9, padding: '9px 18px',
                                fontSize: 13, fontWeight: 500,
                                cursor: starting ? 'not-allowed' : 'pointer',
                                fontFamily: 'inherit',
                                transition: 'background 0.15s',
                            }}
                        >
                            {starting ? 'Starting…' : 'Start session'}
                            {!starting && (
                                <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                                    <path d="M2.5 6.5h8M7 3l3.5 3.5L7 10" stroke="white" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                            )}
                        </button>
                    </div>
                )}
            </main>
        </div>
    );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function DocRow({ doc, isSelected, onToggle }: {
    doc: UploadedDoc;
    isSelected: boolean;
    onToggle: () => void;
}) {
    const canSelect = doc.status === 'ready';
    return (
        <div
            onClick={canSelect ? onToggle : undefined}
            style={{
                display: 'flex', alignItems: 'center', gap: 11,
                background: isSelected ? '#fafefb' : 'var(--card)',
                border: `${isSelected ? '1.5px' : '1px'} solid ${isSelected ? 'var(--acc)' : 'var(--b1)'}`,
                borderRadius: 10, padding: '10px 13px',
                cursor: canSelect ? 'pointer' : 'default',
                transition: 'border-color 0.12s',
            }}
        >
            <div style={{
                width: 17, height: 17, borderRadius: 5, flexShrink: 0,
                border: `1.5px solid ${isSelected ? 'var(--acc)' : 'var(--b2)'}`,
                background: isSelected ? 'var(--acc)' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                opacity: canSelect ? 1 : 0.35,
            }}>
                {isSelected && (
                    <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
                        <path d="M1.5 4.5l2 2 4-4" stroke="white" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                )}
            </div>

            <FileIcon status={doc.status} />

            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--td)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {doc.name}
                </div>
                <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>
                    {doc.sizeMb} MB
                    {doc.status === 'uploading' && ' · uploading...'}
                    {doc.status === 'processing' && ' · parsing...'}
                    {doc.status === 'failed' && ` · ${doc.errorMsg ?? 'failed'}`}
                </div>
                {(doc.status === 'uploading' || doc.status === 'processing') && (
                    <div style={{ height: 3, background: 'var(--b1)', borderRadius: 2, marginTop: 5, overflow: 'hidden' }}>
                        <div style={{ height: 3, background: 'var(--acc)', borderRadius: 2, animation: 'pulse 2s ease-in-out infinite' }} />
                    </div>
                )}
            </div>

            <StatusBadge status={doc.status} />

            <style>{`
        @keyframes pulse {
          0%   { width: 15%; }
          50%  { width: 72%; }
          100% { width: 15%; }
        }
      `}</style>
        </div>
    );
}

function FileIcon({ status }: { status: ParseStatus }) {
    const fill = status === 'failed' ? '#f0dcd8' : '#d0e8d8';
    const stroke = status === 'failed' ? '#8a4a40' : '#4a7259';
    return (
        <div style={{ width: 32, height: 32, borderRadius: 7, background: 'var(--acl)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M2 1h6l4 4v8H2V1z" fill={fill} />
                <path d="M8 1v4h4" stroke={stroke} strokeWidth=".8" />
                <path d="M4 7h6M4 9.5h4" stroke={stroke} strokeWidth=".8" strokeLinecap="round" />
            </svg>
        </div>
    );
}

function StatusBadge({ status }: { status: ParseStatus }) {
    const map: Record<ParseStatus, { bg: string; color: string; label: string }> = {
        uploading: { bg: '#ede8f0', color: '#4a3a60', label: 'Uploading' },
        processing: { bg: '#e0eaf8', color: '#1e3a60', label: 'Processing' },
        ready: { bg: 'var(--acl)', color: '#2a5c38', label: 'Ready' },
        failed: { bg: '#f8e4e0', color: '#5a1e18', label: 'Failed' },
    };
    const { bg, color, label } = map[status];
    return (
        <span style={{ fontSize: 10, fontWeight: 500, padding: '3px 9px', borderRadius: 10, flexShrink: 0, background: bg, color }}>
            {label}
        </span>
    );
}