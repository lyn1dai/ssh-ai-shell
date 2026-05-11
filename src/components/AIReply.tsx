import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ThumbsUp, ThumbsDown, RefreshCw, Copy, Check } from 'lucide-react';
import { writeClipboardText } from '../utils/clipboard';

interface Props {
  text: string;
  complete: boolean;
  onNewSession?: () => void;
  showFeedback?: boolean;
  /** Current AI processing step — shown while the reply is still in progress */
  statusLine?: string;
}

export default function AIReply({ text, complete, onNewSession, showFeedback = false, statusLine }: Props) {
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);
  const [feedbackDone, setFeedbackDone] = useState(false);
  const [actionState, setActionState] = useState<'idle' | 'copied' | 'selected'>('idle');
  const contentRef = useRef<HTMLDivElement>(null);
  const actionToast = actionState === 'copied'
    ? {
        text: '已复制到剪贴板',
        className: 'border-terminal-green/30 bg-terminal-green/15 text-terminal-green',
      }
    : actionState === 'selected'
      ? {
          text: '已全选当前输出',
          className: 'border-terminal-blue/30 bg-terminal-blue/15 text-terminal-blue',
        }
      : null;

  useEffect(() => {
    if (actionState === 'idle') return;
    const timer = window.setTimeout(() => setActionState('idle'), 1800);
    return () => window.clearTimeout(timer);
  }, [actionState]);

  function handleFeedback(type: 'up' | 'down') {
    if (feedbackDone) return;
    setFeedback(type);
    setFeedbackDone(true);
    // Could send to analytics here
  }

  async function handleCopy() {
    const visibleText = contentRef.current?.innerText?.trim() || text;
    try {
      if (contentRef.current) {
        const selection = window.getSelection();
        if (selection) {
          const range = document.createRange();
          range.selectNodeContents(contentRef.current);
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }
      await writeClipboardText(visibleText);
      setActionState('copied');
    } catch {}
  }

  function handleSelectAll() {
    if (!contentRef.current) return;
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(contentRef.current);
    selection.removeAllRanges();
    selection.addRange(range);
    setActionState('selected');
  }

  function handlePointerCapture(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement | null;
    if (target?.closest('button, a, input, textarea')) return;
    e.stopPropagation();
  }

  function handleContextMenuCapture() {
    const node = contentRef.current;
    const selection = window.getSelection();
    if (!node || !selection || selection.rangeCount === 0 || !selection.toString()) return;

    const range = selection.getRangeAt(0);
    if (!node.contains(range.commonAncestorContainer)) return;

    const preservedRange = range.cloneRange();
    const restore = () => {
      const currentSelection = window.getSelection();
      if (!currentSelection) return;
      currentSelection.removeAllRanges();
      currentSelection.addRange(preservedRange);
    };

    requestAnimationFrame(restore);
    window.setTimeout(restore, 0);
  }

  const renderedContent = useMemo(() => {
    if (!text) return null;

    if (!complete) {
      return <div className="whitespace-pre-wrap break-words">{text}</div>;
    }

    return (
      <ReactMarkdown remarkPlugins={[remarkGfm]}
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
            return <strong className="font-semibold text-terminal-text">{children}</strong>;
          },
          blockquote({ children }) {
            return (
              <blockquote className="border-l-2 border-terminal-blue/50 pl-3 text-terminal-muted my-1">
                {children}
              </blockquote>
            );
          },
          h1({ children }) { return <h1 className="text-base font-bold text-terminal-text mb-1">{children}</h1>; },
          h2({ children }) { return <h2 className="text-sm font-bold text-terminal-text mb-1">{children}</h2>; },
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
    );
  }, [complete, text]);

  return (
    <div
      data-allow-selection="true"
      className="ai-selectable animate-slide-up my-1"
      onMouseDownCapture={handlePointerCapture}
      onClickCapture={handlePointerCapture}
      onContextMenuCapture={handleContextMenuCapture}
    >
      {/* AI reply bubble */}
      <div className="flex gap-2">
        {/* Blue dot indicator */}
        <div className="flex-shrink-0 mt-1">
          <span className="inline-block w-2 h-2 rounded-full bg-terminal-blue shadow-[0_0_6px_#58a6ff]" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="relative text-sm text-terminal-text leading-relaxed ai-markdown">
            {actionToast && (
              <div
                data-copy-exclude="true"
                className={`pointer-events-none absolute right-0 top-0 z-10 inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] shadow-lg backdrop-blur-sm ${actionToast.className}`}
              >
                <Check className="h-3 w-3" />
                <span>{actionToast.text}</span>
              </div>
            )}

            {text && (
              <div className="mb-2 flex items-center justify-between gap-2 text-[11px] text-terminal-muted">
                <span>{complete ? 'AI 输出' : 'AI 输出中'}</span>
                <div data-copy-exclude="true" className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleCopy}
                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 transition-colors ${
                      actionState === 'copied'
                        ? 'border-terminal-green/30 bg-terminal-green/10 text-terminal-green'
                        : 'border-terminal-border text-terminal-muted hover:text-terminal-text hover:border-terminal-blue/40'
                    }`}
                  >
                    {actionState === 'copied' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    {actionState === 'copied' ? '已复制' : '复制'}
                  </button>
                  <button
                    type="button"
                    onClick={handleSelectAll}
                    className={`rounded-md border px-2 py-0.5 transition-colors ${
                      actionState === 'selected'
                        ? 'border-terminal-blue/30 bg-terminal-blue/10 text-terminal-blue'
                        : 'border-terminal-border text-terminal-muted hover:text-terminal-text hover:border-terminal-blue/40'
                    }`}
                  >
                    {actionState === 'selected' ? '已全选' : '全选'}
                  </button>
                </div>
              </div>
            )}

            <div ref={contentRef} className="select-text">
            {text ? (
              renderedContent
            ) : (
              <span className="inline-flex items-center gap-2 text-terminal-muted">
                <span className="inline-flex gap-1 items-center">
                  <span className="w-1 h-1 rounded-full bg-terminal-blue animate-bounce [animation-delay:0ms]" />
                  <span className="w-1 h-1 rounded-full bg-terminal-blue animate-bounce [animation-delay:150ms]" />
                  <span className="w-1 h-1 rounded-full bg-terminal-blue animate-bounce [animation-delay:300ms]" />
                </span>
                <span className="text-xs text-terminal-muted/90">{statusLine || 'AI 正在思考...'}</span>
              </span>
            )}
            </div>

            {/* Streaming cursor */}
            {!complete && text && (
              <span className="inline-block w-1.5 h-3.5 bg-terminal-blue/60 ml-0.5 animate-blink align-middle" />
            )}

            {/* AI step status — compact one-liner while reply is in progress */}
            {!complete && statusLine && (
              <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-terminal-muted/70 font-mono">
                <span className="inline-block w-1 h-1 rounded-full bg-terminal-blue/50 animate-pulse flex-shrink-0" />
                <span className="truncate">{statusLine}</span>
              </div>
            )}
          </div>

          {/* Feedback row — shown when reply is complete */}
          {complete && showFeedback && (
            <div data-copy-exclude="true" className="flex items-center gap-2 mt-2 pt-2 border-t border-terminal-border/30">
              {/* Thumbs feedback */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleFeedback('up')}
                  disabled={feedbackDone}
                  title={feedbackDone && feedback === 'up' ? '已评为有用' : '有帮助'}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-all
                    ${feedback === 'up'
                      ? 'bg-terminal-green/15 text-terminal-green border border-terminal-green/30'
                      : 'text-terminal-muted hover:text-terminal-green hover:bg-terminal-green/10 border border-transparent'
                    } ${feedbackDone && feedback !== 'up' ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <ThumbsUp className="w-3 h-3" />
                  {feedback === 'up' && <span>有用</span>}
                </button>
                <button
                  onClick={() => handleFeedback('down')}
                  disabled={feedbackDone}
                  title={feedbackDone && feedback === 'down' ? '已评为没用' : '没帮助'}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-all
                    ${feedback === 'down'
                      ? 'bg-terminal-red/15 text-terminal-red border border-terminal-red/30'
                      : 'text-terminal-muted hover:text-terminal-red hover:bg-terminal-red/10 border border-transparent'
                    } ${feedbackDone && feedback !== 'down' ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <ThumbsDown className="w-3 h-3" />
                  {feedback === 'down' && <span>没用</span>}
                </button>
                {feedbackDone && (
                  <span className="text-[10px] text-terminal-muted ml-1">感谢反馈</span>
                )}
              </div>

              <div className="flex-1" />

              {/* New session button */}
              {onNewSession && (
                <button
                  onClick={onNewSession}
                  className="flex items-center gap-1.5 text-xs text-terminal-muted hover:text-terminal-blue transition-colors border border-terminal-border hover:border-terminal-blue/40 rounded-md px-2.5 py-1 hover:bg-terminal-blue/5"
                  title="清除 AI 对话历史，开始新的对话"
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
