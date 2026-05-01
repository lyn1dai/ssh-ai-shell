import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ThumbsUp, ThumbsDown, RefreshCw } from 'lucide-react';

interface Props {
  text: string;
  complete: boolean;
  onNewSession?: () => void;
  showFeedback?: boolean;
}

export default function AIReply({ text, complete, onNewSession, showFeedback = false }: Props) {
  return (
    <div className="animate-slide-up my-1">
      {/* AI reply bubble */}
      <div className="flex gap-2">
        {/* Blue dot indicator */}
        <div className="flex-shrink-0 mt-1">
          <span className="inline-block w-2 h-2 rounded-full bg-terminal-blue shadow-[0_0_6px_#58a6ff]" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="text-sm text-terminal-text leading-relaxed ai-markdown">
            {text ? (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  code({ node, className, children, ...props }) {
                    const isBlock = className?.includes('language-');
                    const content = String(children).replace(/\n$/, '');
                    if (isBlock) {
                      return (
                        <pre className="bg-terminal-bg border border-terminal-border rounded-md px-3 py-2 my-2 overflow-x-auto text-xs">
                          <code className="text-terminal-cyan font-mono">{content}</code>
                        </pre>
                      );
                    }
                    return (
                      <code
                        className="bg-terminal-bg border border-terminal-border rounded px-1.5 py-0.5 text-xs text-terminal-cyan font-mono"
                        {...props}
                      >
                        {children}
                      </code>
                    );
                  },
                  a({ href, children }) {
                    return (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-terminal-blue underline underline-offset-2 hover:text-terminal-blue/80"
                      >
                        {children}
                      </a>
                    );
                  },
                  p({ children }) {
                    return <p className="mb-1 last:mb-0">{children}</p>;
                  },
                  ul({ children }) {
                    return <ul className="list-disc list-inside mb-1 space-y-0.5">{children}</ul>;
                  },
                  ol({ children }) {
                    return <ol className="list-decimal list-inside mb-1 space-y-0.5">{children}</ol>;
                  },
                  li({ children }) {
                    return <li className="text-terminal-text">{children}</li>;
                  },
                  strong({ children }) {
                    return <strong className="font-semibold text-white">{children}</strong>;
                  },
                  blockquote({ children }) {
                    return (
                      <blockquote className="border-l-2 border-terminal-blue/50 pl-3 text-terminal-muted my-1">
                        {children}
                      </blockquote>
                    );
                  },
                  h1({ children }) { return <h1 className="text-base font-bold text-white mb-1">{children}</h1>; },
                  h2({ children }) { return <h2 className="text-sm font-bold text-white mb-1">{children}</h2>; },
                  h3({ children }) { return <h3 className="text-sm font-semibold text-terminal-text mb-1">{children}</h3>; },
                  table({ children }) {
                    return (
                      <div className="overflow-x-auto my-2">
                        <table className="text-xs border-collapse border border-terminal-border">{children}</table>
                      </div>
                    );
                  },
                  th({ children }) {
                    return <th className="border border-terminal-border px-2 py-1 bg-terminal-surface text-terminal-text font-semibold">{children}</th>;
                  },
                  td({ children }) {
                    return <td className="border border-terminal-border px-2 py-1 text-terminal-muted">{children}</td>;
                  },
                }}
              >
                {text}
              </ReactMarkdown>
            ) : (
              <span className="text-terminal-muted">
                <span className="inline-flex gap-1 items-center">
                  <span className="w-1 h-1 rounded-full bg-terminal-blue animate-bounce [animation-delay:0ms]" />
                  <span className="w-1 h-1 rounded-full bg-terminal-blue animate-bounce [animation-delay:150ms]" />
                  <span className="w-1 h-1 rounded-full bg-terminal-blue animate-bounce [animation-delay:300ms]" />
                </span>
              </span>
            )}

            {/* Streaming cursor */}
            {!complete && text && (
              <span className="inline-block w-1.5 h-3.5 bg-terminal-blue/60 ml-0.5 animate-blink align-middle" />
            )}
          </div>

          {/* Feedback row — shown when reply is complete */}
          {complete && showFeedback && (
            <div className="flex items-center gap-2 mt-2">
              <button
                className="flex items-center gap-1 text-terminal-muted hover:text-terminal-green text-xs transition-colors"
                title="有帮助"
              >
                <ThumbsUp className="w-3 h-3" />
              </button>
              <button
                className="flex items-center gap-1 text-terminal-muted hover:text-terminal-red text-xs transition-colors"
                title="没帮助"
              >
                <ThumbsDown className="w-3 h-3" />
              </button>
              {onNewSession && (
                <button
                  onClick={onNewSession}
                  className="flex items-center gap-1 text-terminal-muted hover:text-terminal-text text-xs transition-colors ml-2 border border-terminal-border rounded px-2 py-0.5"
                >
                  <RefreshCw className="w-3 h-3" />
                  开启新会话
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
