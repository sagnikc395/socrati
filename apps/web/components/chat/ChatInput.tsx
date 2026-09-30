import { useRef, useEffect } from 'react';

interface ChatInputProps {
    input: string;
    handleInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
    handleSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
    setInput: (value: string) => void;
    isLoading: boolean;
}

export function ChatInput({ input, handleInputChange, handleSubmit, setInput, isLoading }: ChatInputProps) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Auto-resize textarea logic from your prototype
    useEffect(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        ta.style.height = 'auto';
        ta.style.height = Math.min(ta.scrollHeight, 140) + 'px';
    }, [input]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            // Programmatically submit the form when Enter is pressed
            const form = e.currentTarget.form;
            if (form) form.requestSubmit();
        }
    };

    return (
        <div style={{ padding: '0 24px 20px', flexShrink: 0 }}>
            {/* Hint bar from your prototype */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 8, overflowX: 'auto' }}>
                {['give me a hint', "I don't understand", 'can you rephrase that'].map(hint => (
                    <button
                        key={hint}
                        onClick={() => { setInput(hint); textareaRef.current?.focus(); }}
                        type="button"
                        className="btn btn-secondary"
                        style={{ fontSize: 11, borderRadius: 99, padding: '4px 12px', whiteSpace: 'nowrap' }}
                    >
                        {hint}
                    </button>
                ))}
            </div>

            <form onSubmit={handleSubmit} style={{
                display: 'flex',
                alignItems: 'flex-end',
                gap: 10,
                background: 'var(--card)',
                border: '1px solid var(--b1)',
                borderRadius: 14,
                padding: '10px 12px 10px 16px',
            }}>
                <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    placeholder="Your answer..."
                    rows={1}
                    style={{
                        flex: 1,
                        border: 'none',
                        outline: 'none',
                        resize: 'none',
                        fontFamily: 'inherit',
                        fontSize: 14,
                        color: 'var(--td)',
                        background: 'transparent',
                        lineHeight: '1.5',
                    }}
                />
                <button
                    type="submit"
                    disabled={!input?.trim() || isLoading}
                    style={{
                        width: 34,
                        height: 34,
                        borderRadius: 9,
                        border: 'none',
                        background: input?.trim() && !isLoading ? 'var(--acc)' : 'var(--b1)',
                        cursor: input?.trim() && !isLoading ? 'pointer' : 'default',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        transition: 'background 0.15s',
                    }}
                >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path d="M2 7h10M8 3l4 4-4 4" stroke="white" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                </button>
            </form>
            <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 6, textAlign: 'center' }}>
                Press Enter to send · Shift+Enter for new line
            </div>
        </div>
    );
}
