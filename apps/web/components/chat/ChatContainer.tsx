'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { MindMapPanel } from '@/components/mindmap/MindMapPanel';

type ChatDocument = {
    document_id: string;
    title: string;
};

export function ChatContainer({ 
    sessionId, 
    documentIds,
    documents = [],
    initialMessages = []
}: { 
    sessionId: string; 
    documentIds: string[];
    documents?: ChatDocument[];
    initialMessages?: UIMessage[];
}) {
    const [input, setInput] = useState('');
    const [showMindMap, setShowMindMap] = useState(false);
    const router = useRouter();
    
    // useRef ensures the fetch interceptor always reads the LATEST documentIds,
    // even though useChat's closure is only created once on mount.
    const documentIdsRef = useRef<string[]>(documentIds);
    useEffect(() => { documentIdsRef.current = documentIds; }, [documentIds]);

    const defaultMessage: UIMessage = {
        id: 'opening-msg',
        role: 'assistant',
        parts: [{ type: 'text', text: "I've looked through your uploaded material. Before we dive in — what topic feels least solid to you right now?" }],
    };

    const { messages, setMessages, sendMessage, status } = useChat({
        id: sessionId,
        transport: new DefaultChatTransport({ api: '/api/chat' }),
    });

    // Explicitly hydrate state (bypasses initialMessages reference bugs in some AI SDK versions)
    useEffect(() => {
        if (messages.length === 0) {
            const initial = initialMessages && initialMessages.length > 0 ? initialMessages : [defaultMessage];
            setMessages(initial);
        }
    }, [initialMessages, messages.length, setMessages]);

    const isLoading = status === 'submitted' || status === 'streaming';
    const bottomRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom on new messages
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setInput(e.target.value);
    };

    const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!input.trim() || isLoading) return;
        void sendMessage(
            { text: input.trim() },
            { body: { sessionId, documentIds: documentIdsRef.current } }
        );
        setInput('');
    };

    return (
        <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
        }}>
            {/* Header bar */}
            <div style={{
                padding: '14px 24px',
                borderBottom: '1px solid var(--b1)',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                background: 'var(--main)',
                flexShrink: 0,
            }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--td)' }}>
                    Tutoring Session
                </div>
                <div style={{
                    fontSize: 11,
                    color: 'var(--t3)',
                    background: 'var(--acl)',
                    padding: '2px 10px',
                    borderRadius: 99,
                }}>
                    Socratic mode
                </div>
                <div style={{ flex: 1 }} />
                <button
                    onClick={() => setShowMindMap((visible) => !visible)}
                    disabled={documents.length === 0}
                    className="btn-chip"
                >
                    Mind Map
                </button>
                <button
                    onClick={() => router.push(`/sessions/${sessionId}/quiz`)}
                    className="btn-chip"
                >
                    📝 Generate quiz
                </button>
            </div>

            {/* Messages Area */}
            <div style={{
                flex: 1,
                overflowY: 'auto',
                padding: '24px',
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
            }}>
                {messages?.map((msg) => (
                    <ChatMessage key={msg.id} message={msg} />
                ))}

                {isLoading && messages?.[messages.length - 1]?.role === 'user' && (
                    <div style={{ fontSize: 13, color: 'var(--t3)', marginLeft: 8 }}>Thinking...</div>
                )}

                <div ref={bottomRef} />
            </div>

            {/* Input Area */}
            <ChatInput
                input={input}
                handleInputChange={handleInputChange}
                handleSubmit={handleSubmit}
                setInput={setInput}
                isLoading={isLoading}
            />
            {showMindMap && documents.length > 0 && (
                <MindMapPanel documents={documents} onClose={() => setShowMindMap(false)} />
            )}
        </div>
    );
}
