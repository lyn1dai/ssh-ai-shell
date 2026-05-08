import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronRight, Plus, Copy, ClipboardPaste, Globe, Power } from 'lucide-react';

interface Props {
  x: number;
  y: number;
  selectedText: string;
  appendToCopyHistory: boolean;
  charset: string;
  onClose: () => void;
  onNewTerminal: () => void;
  onCopySelection: () => void;
  onCopyScreen: () => void;
  onCopyBuffer: () => void;
  onToggleAppendToCopyHistory: () => void;
  onShowCopyHistory: () => void;
  onPaste: () => void;
  onAddToPasteHistory: () => void;
  onShowPasteHistory: () => void;
  onSetCharset: (locale: string, encoding: string) => void;
  onDisconnect: () => void;
  onSplitRight?: () => void;
  onSplitLeft?: () => void;
  onSplitDown?: () => void;
  onSplitUp?: () => void;
}

const CHARSETS: Record<string, string[]> = {
  en_US: ['UTF-8', 'US-ASCII', 'ISO-8859-15', 'ISO-8859-1'],
  zh_CN: ['UTF-8', 'GB18030', 'GBK', 'GB2312'],
  zh_TW: ['UTF-8', 'Big5'],
};
const LOCALE_NAMES: Record<string, string> = {
  en_US: '英语（美国）',
  zh_CN: '简体中文',
  zh_TW: '繁体中文',
};
const STANDALONE_LOCALES = ['C', 'POSIX'];

export default function TerminalContextMenu({
  x, y, selectedText,
  appendToCopyHistory, charset,
  onClose, onNewTerminal,
  onCopySelection, onCopyScreen, onCopyBuffer,
  onToggleAppendToCopyHistory, onShowCopyHistory,
  onPaste, onAddToPasteHistory, onShowPasteHistory,
  onSetCharset, onDisconnect,
  onSplitRight, onSplitLeft, onSplitDown, onSplitUp,
}: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [openSub, setOpenSub] = useState<'copy' | 'paste' | 'charset' | null>(null);
  const [openLocale, setOpenLocale] = useState<string | null>(null);

  // Keep a stable ref to onClose so the mousedown/keydown effect only registers
  // once (on mount) rather than re-registering every time TerminalPage re-renders
  // and creates a new inline arrow for onClose.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  // ── Split direction icons (SVG) ─────────────────────────────────────────
  const SplitRight = () => (
    <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 16 16" fill="currentColor">
      <rect x="1" y="2" width="6" height="12" rx="1.2" opacity="0.4"/>
      <rect x="9" y="2" width="6" height="12" rx="1.2"/>
    </svg>
  );
  const SplitLeft = () => (
    <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 16 16" fill="currentColor">
      <rect x="1" y="2" width="6" height="12" rx="1.2"/>
      <rect x="9" y="2" width="6" height="12" rx="1.2" opacity="0.4"/>
    </svg>
  );
  const SplitDown = () => (
    <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 16 16" fill="currentColor">
      <rect x="2" y="1" width="12" height="6" rx="1.2" opacity="0.4"/>
      <rect x="2" y="9" width="12" height="6" rx="1.2"/>
    </svg>
  );
  const SplitUp = () => (
    <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 16 16" fill="currentColor">
      <rect x="2" y="1" width="12" height="6" rx="1.2"/>
      <rect x="2" y="9" width="12" height="6" rx="1.2" opacity="0.4"/>
    </svg>
  );

  // Parse current charset, e.g. "en_US.UTF-8" → locale="en_US", encoding="UTF-8"
  const dotIdx = charset.indexOf('.');
  const curLocale = dotIdx >= 0 ? charset.slice(0, dotIdx) : charset;
  const curEncoding = dotIdx >= 0 ? charset.slice(dotIdx + 1) : charset;

  // Clamp to viewport
  const vpW = window.innerWidth;
  const vpH = window.innerHeight;
  const MENU_W = 228;
  const SUB_W = 178;
  const MENU_H_EST = 330;
  const cx = Math.max(4, Math.min(x, vpW - MENU_W - 4));
  const cy = Math.max(4, Math.min(y, vpH - MENU_H_EST - 4));
  // Direction for first-level submenus
  const subDir: React.CSSProperties =
    cx + MENU_W + SUB_W > vpW
      ? { right: '100%', marginRight: '2px' }
      : { left: '100%', marginLeft: '2px' };
  // Direction for second-level submenus (locale → encodings)
  const sub2Dir: React.CSSProperties =
    cx + MENU_W + SUB_W + SUB_W > vpW
      ? { right: '100%', marginRight: '2px' }
      : { left: '100%', marginLeft: '2px' };

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onCloseRef.current();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, []); // Empty deps: register once on mount; latest onClose always reached via ref

  /** Invoke action and close the menu. */
  const act = (fn: () => void) => { fn(); onClose(); };

  // Shared class strings
  const row =
    'flex items-center gap-2 w-full text-left px-3 py-[5px] text-xs text-terminal-text ' +
    'hover:bg-terminal-border/30 rounded transition-colors cursor-pointer select-none';
  const dimRow =
    'flex items-center gap-2 w-full text-left px-3 py-[5px] text-xs text-terminal-muted ' +
    'rounded cursor-default select-none opacity-50';
  const redRow =
    'flex items-center gap-2 w-full text-left px-3 py-[5px] text-xs text-terminal-red ' +
    'hover:bg-terminal-red/10 rounded transition-colors cursor-pointer select-none';
  const subBase =
    'absolute top-0 z-[10000] bg-terminal-surface border border-terminal-border ' +
    'rounded-lg shadow-2xl py-1';
  const sep = <div className="h-px bg-terminal-border/50 my-0.5 mx-2" />;
  /** Placeholder matching the size of the Check icon so text aligns. */
  const Blank = () => <span className="w-3 h-3 flex-shrink-0 inline-block" />;

  const closeSubs = () => { setOpenSub(null); setOpenLocale(null); };

  return (
    <div
      ref={menuRef}
      className="fixed z-[9999] bg-terminal-surface border border-terminal-border rounded-lg shadow-2xl py-1"
      style={{ left: cx, top: cy, minWidth: MENU_W }}
      onContextMenu={e => e.preventDefault()}
    >
      {/* ── 新建终端 ─────────────────────────────────────────── */}
      <button className={row} onClick={() => act(onNewTerminal)} onMouseEnter={closeSubs}>
        <Plus className="w-3.5 h-3.5 text-terminal-muted flex-shrink-0" />
        <span className="flex-1">新建终端</span>
        <span className="text-[10px] text-terminal-muted/70 font-mono">Ctrl+`</span>
      </button>

      {/* ── 拆分 ─────────────────────────────────────────────── */}
      {(onSplitRight || onSplitLeft || onSplitDown || onSplitUp) && (<>
        {onSplitRight && (
          <button className={row} onClick={() => act(onSplitRight)} onMouseEnter={closeSubs}>
            <SplitRight />
            <span className="flex-1">向右拆分</span>
          </button>
        )}
        {onSplitLeft && (
          <button className={row} onClick={() => act(onSplitLeft)} onMouseEnter={closeSubs}>
            <SplitLeft />
            <span className="flex-1">向左拆分</span>
          </button>
        )}
        {onSplitDown && (
          <button className={row} onClick={() => act(onSplitDown)} onMouseEnter={closeSubs}>
            <SplitDown />
            <span className="flex-1">向下拆分</span>
          </button>
        )}
        {onSplitUp && (
          <button className={row} onClick={() => act(onSplitUp)} onMouseEnter={closeSubs}>
            <SplitUp />
            <span className="flex-1">向上拆分</span>
          </button>
        )}
      </>)}

      {sep}

      {/* ── 复制 submenu ──────────────────────────────────────── */}
      <div
        className="relative"
        onMouseEnter={() => { setOpenSub('copy'); setOpenLocale(null); }}
      >
        <button
          className={row}
          onClick={() => act(selectedText ? onCopySelection : onCopyScreen)}
        >
          <Copy className="w-3.5 h-3.5 text-terminal-muted flex-shrink-0" />
          <span className="flex-1">复制{selectedText ? '选中文本' : ''}</span>
          <ChevronRight className="w-3.5 h-3.5 text-terminal-muted flex-shrink-0" />
        </button>

        {openSub === 'copy' && (
          <div className={subBase} style={{ ...subDir, minWidth: SUB_W }}>
            <button
              className={selectedText ? row : dimRow}
              onClick={() => selectedText ? act(onCopySelection) : undefined}
            >
              复制选中文本
            </button>
            <button className={row} onClick={() => act(onCopyScreen)}>复制当前屏幕</button>
            <button className={row} onClick={() => act(onCopyBuffer)}>复制屏幕缓冲区</button>
            {sep}
            {/* Toggle (stays open after click) */}
            <button className={row} onClick={onToggleAppendToCopyHistory}>
              {appendToCopyHistory
                ? <Check className="w-3 h-3 text-terminal-blue flex-shrink-0" />
                : <Blank />}
              <span className="flex-1">追加到复制历史</span>
            </button>
            <button className={row} onClick={() => act(onShowCopyHistory)}>查看复制历史记录</button>
          </div>
        )}
      </div>

      {/* ── 粘贴 submenu ──────────────────────────────────────── */}
      <div
        className="relative"
        onMouseEnter={() => { setOpenSub('paste'); setOpenLocale(null); }}
      >
        <button className={row} onClick={() => act(onPaste)}>
          <ClipboardPaste className="w-3.5 h-3.5 text-terminal-muted flex-shrink-0" />
          <span className="flex-1">粘贴</span>
          <ChevronRight className="w-3.5 h-3.5 text-terminal-muted flex-shrink-0" />
        </button>

        {openSub === 'paste' && (
          <div className={subBase} style={{ ...subDir, minWidth: SUB_W }}>
            <button className={row} onClick={() => act(onPaste)}>粘贴</button>
            <button className={row} onClick={() => act(onAddToPasteHistory)}>追加到粘贴历史</button>
            <button className={row} onClick={() => act(onShowPasteHistory)}>查看粘贴历史记录</button>
          </div>
        )}
      </div>

      {sep}

      {/* ── 字符集 submenu (3-level) ──────────────────────────── */}
      <div
        className="relative"
        onMouseEnter={() => { setOpenSub('charset'); setOpenLocale(null); }}
      >
        <div className={row}>
          <Globe className="w-3.5 h-3.5 text-terminal-muted flex-shrink-0" />
          <span className="flex-1">字符集</span>
          <ChevronRight className="w-3.5 h-3.5 text-terminal-muted flex-shrink-0" />
        </div>

        {openSub === 'charset' && (
          <div className={subBase} style={{ ...subDir, minWidth: SUB_W }}>
            {Object.entries(CHARSETS).map(([locale, encodings]) => (
              <div
                key={locale}
                className="relative"
                onMouseEnter={() => setOpenLocale(locale)}
              >
                <div className={row}>
                  <span className="flex-1">{LOCALE_NAMES[locale] ?? locale}</span>
                  <ChevronRight className="w-3.5 h-3.5 text-terminal-muted flex-shrink-0" />
                </div>

                {openLocale === locale && (
                  <div className={subBase} style={{ ...sub2Dir, minWidth: SUB_W }}>
                    {encodings.map(enc => (
                      <button
                        key={enc}
                        className={row}
                        onClick={() => act(() => onSetCharset(locale, enc))}
                      >
                        {curLocale === locale && curEncoding === enc
                          ? <Check className="w-3 h-3 text-terminal-blue flex-shrink-0" />
                          : <Blank />}
                        <span>{enc}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {sep}

            {STANDALONE_LOCALES.map(loc => (
              <button
                key={loc}
                className={row}
                onClick={() => act(() => onSetCharset(loc, loc))}
                onMouseEnter={() => setOpenLocale(null)}
              >
                {curLocale === loc
                  ? <Check className="w-3 h-3 text-terminal-blue flex-shrink-0" />
                  : <Blank />}
                <span>{loc}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {sep}

      {/* ── 断开连接 ──────────────────────────────────────────── */}
      <button className={redRow} onClick={(e) => { e.stopPropagation(); act(onDisconnect); }} onMouseEnter={closeSubs}>
        <Power className="w-3.5 h-3.5 flex-shrink-0" />
        <span>断开连接</span>
      </button>
    </div>
  );
}
