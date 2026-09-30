import type { UIMessage } from 'ai';

const WEB_SEARCH_TAG = '<!-- web_search_used -->';

// ai v6 UIMessage carries `parts` only; DB-hydrated messages arrive with a
// plain `content` string, so read it off a loosened type here.
type IncomingMessage = UIMessage & { content?: string };

export function ChatMessage({ message }: { message: IncomingMessage }) {
    const isUser = message.role === 'user';

    const text = isUser
        ? typeof message.content === 'string' ? message.content : ''
        : message.parts
              ?.filter((p) => p.type === 'text')
              .map((p) => (p.type === 'text' ? p.text : ''))
              .join('') || message.content || '';

    // Hidden tag from the server signals that this turn used web search
    const webSearchUsed = text.includes(WEB_SEARCH_TAG) ||
        (message.metadata as { webSearchUsed?: boolean } | undefined)?.webSearchUsed === true;
    const cleanedText = text.replace(WEB_SEARCH_TAG, '').trim();

    return (
        <div style={{
            display: 'flex',
            justifyContent: isUser ? 'flex-end' : 'flex-start',
        }}>
            <div style={{
                maxWidth: '70%',
                padding: '11px 15px',
                borderRadius: isUser ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                background: isUser ? 'var(--acc)' : 'var(--card)',
                border: isUser ? 'none' : '1px solid var(--b1)',
                fontSize: 14,
                lineHeight: '1.6',
                color: isUser ? '#eef8f2' : 'var(--td)',
                whiteSpace: 'pre-wrap',
            }}>
                {webSearchUsed && (
                    <div style={{
                        fontSize: 11,
                        padding: '4px 8px',
                        background: 'var(--b1)',
                        borderRadius: 6,
                        marginBottom: cleanedText ? 10 : 0,
                        color: 'var(--td)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        fontWeight: 500,
                        border: '1px solid var(--b2)'
                    }}>
                        🌐 Web Search Used
                    </div>
                )}
                {cleanedText}
            </div>
        </div>
    );
}
