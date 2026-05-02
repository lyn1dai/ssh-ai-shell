import React, {
  forwardRef, useCallback, useEffect, useImperativeHandle, useRef,
} from 'react';
import { hterm } from 'hterm/public';
import type { TerminalSettings } from '../types';

export interface HtermTerminalHandle {
  write: (data: string) => void;
  pasteText: (text: string) => void;
  clear: () => void;
  focus: () => void;
  syncSize: () => void;
  hasFocus: () => boolean;
  getSelectionText: () => string;
  getVisibleText: () => string;
  getAllText: () => string;
  pageUp: () => void;
  pageDown: () => void;
}

interface Props {
  settings: TerminalSettings;
  onData: (data: string) => void;
  onResize?: (size: { cols: number; rows: number }) => void;
  onFocusChange?: (focused: boolean) => void;
  className?: string;
}

// Cursor shape strings used by hterm (from hterm/struct/cursor_shape)
const CURSOR_SHAPE: Record<TerminalSettings['cursorStyle'], string> = {
  block: 'BLOCK',
  bar: 'BEAM',
  underline: 'UNDERLINE',
};

/** Read a CSS custom property (space-separated r g b) → "rgb(r, g, b)" */
function cssVarRgb(name: string, fallback: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!raw) return fallback;
  const parts = raw.split(/\s+/);
  if (parts.length === 3) return `rgb(${parts[0]}, ${parts[1]}, ${parts[2]})`;
  return raw; // already a full color value
}

/** Read a CSS custom property (space-separated r g b) → "rgba(r, g, b, a)" */
function cssVarRgba(name: string, alpha: number, fallback: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!raw) return fallback;
  const parts = raw.split(/\s+/);
  if (parts.length === 3) return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${alpha})`;
  return fallback;
}

/** Read the 16-color ANSI palette from CSS variables */
function readAnsiPalette(): string[] {
  return Array.from({ length: 16 }, (_, i) => {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(`--ansi-${i}`).trim();
    return raw.replace(/\s+/g, '') || '#4e4e4e';
  });
}

const HtermTerminal = forwardRef<HtermTerminalHandle, Props>(function HtermTerminal(
  { settings, onData, onResize, onFocusChange, className },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  // hterm.Terminal instance (typed as any – hterm has no TypeScript declarations)
  const termRef = useRef<any>(null);
  // The pushed IO object we use to send/receive data
  const ioRef = useRef<any>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const lastSizeRef = useRef({ cols: 0, rows: 0 });
  // Pending data buffer for rAF-coalesced writes
  const writeBufRef = useRef('');
  const writeRafRef = useRef<number | null>(null);

  // Keep callback refs current so the stable closure below always calls the latest version
  const onDataRef = useRef(onData);
  const onResizeRef = useRef(onResize);
  const onFocusChangeRef = useRef(onFocusChange);
  const settingsRef = useRef(settings);

  useEffect(() => { onDataRef.current = onData; }, [onData]);
  useEffect(() => { onResizeRef.current = onResize; }, [onResize]);
  useEffect(() => { onFocusChangeRef.current = onFocusChange; }, [onFocusChange]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  // ── syncSize ────────────────────────────────────────────────────────────────
  // Asks hterm to re-compute cols/rows from the current container pixel size.
  // hterm's onResize_ does exactly this: reads scrollPort dimensions, divides
  // by characterSize, and calls realizeSize_ + io.onTerminalResize_.
  const syncSize = useCallback(() => {
    const term = termRef.current;
    if (!term) return;
    try {
      // onResize_ is "private" by convention but fully accessible in JS.
      term.onResize_();
    } catch {
      // Fallback: ask the scrollPort to re-measure and fire its resize event.
      try { term.scrollPort_.resize(); } catch { /* ignore */ }
    }
  }, []);

  // ── applyAppearance ─────────────────────────────────────────────────────────
  const applyAppearance = useCallback(() => {
    const term = termRef.current;
    if (!term) return;
    const s = settingsRef.current;

    const fontFamily =
      `'${s.fontFamily}', 'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace`;

    term.setFontSize(s.fontSize);
    term.setFontFamily(fontFamily);

    term.setBackgroundColor(cssVarRgb('--tw-c-term-bg', 'rgb(13, 17, 23)'));
    term.setForegroundColor(cssVarRgb('--tw-c-term-fg', 'rgb(240, 240, 240)'));
    term.setCursorColor(cssVarRgba('--tw-c-green', 0.95, 'rgba(63, 185, 80, 0.95)'));

    // Cursor shape: 'BLOCK' | 'BEAM' | 'UNDERLINE'
    term.setCursorShape(CURSOR_SHAPE[s.cursorStyle] ?? 'BLOCK');
    term.setCursorBlink(s.cursorBlink);

    // ANSI 16-color palette
    term.config.set('color-palette-overrides', readAnsiPalette());

    // Re-measure character size after font changes, then recompute cols/rows
    try { term.scrollPort_.syncCharacterSize(); } catch { /* may not exist on all versions */ }
    syncSize();
  }, [syncSize]);

  // ── Mount terminal ──────────────────────────────────────────────────────────
  useEffect(() => {
    const host = hostRef.current;
    if (!host || termRef.current) return;

    // ── Create terminal ──
    const terminal = new hterm.Terminal();
    termRef.current = terminal;

    // Suppress the built-in "226x49" resize-notification overlay.
    // hterm calls overlaySize() from onResize_() every time cols/rows change;
    // that toast is useful in a standalone Crosh window but distracting here.
    terminal.overlaySize = () => {};

    // ── Configure before decorate ──
    const s = settingsRef.current;
    const fontFamily =
      `'${s.fontFamily}', 'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace`;

    terminal.config.set('font-size', s.fontSize);
    terminal.config.set('font-family', fontFamily);
    terminal.config.set('cursor-blink', s.cursorBlink);
    terminal.config.set('background-color', cssVarRgb('--tw-c-term-bg', 'rgb(13, 17, 23)'));
    terminal.config.set('foreground-color', cssVarRgb('--tw-c-term-fg', 'rgb(240, 240, 240)'));
    terminal.config.set('cursor-color', cssVarRgba('--tw-c-green', 0.95, 'rgba(63, 185, 80, 0.95)'));
    terminal.config.set('scrollbar-visible', false);
    terminal.config.set('scroll-on-output', false);
    terminal.config.set('scroll-on-keystroke', true);
    // Disable hterm's built-in Ctrl-C copy / Ctrl-V paste intercepts so the
    // server receives these keystrokes raw.
    terminal.config.set('ctrl-c-copy', false);
    terminal.config.set('ctrl-v-paste', false);
    // Don't let hterm zoom in/out with Ctrl +/-
    terminal.config.set('ctrl-plus-minus-zero-zoom', false);
    terminal.config.set('color-palette-overrides', readAnsiPalette());

    // ── Attach to DOM ──
    // setWidth/setHeight(null) → div.style.width/height = '100%' → fills container
    terminal.decorate(host);
    terminal.setWidth(null);
    terminal.setHeight(null);
    terminal.installKeyboard();

    // hterm creates its internal iframe as `position:absolute` with NO `top` or
    // `left` specified, relying on the browser's static-position fallback.
    // On some browsers/zoom levels this can produce a sub-pixel or even a full
    // character-width left offset, causing all terminal content (line numbers,
    // cursor, etc.) to appear indented away from the left edge.
    // Explicitly anchoring the iframe at (0, 0) of the host div eliminates this.
    try {
      const iframe: HTMLIFrameElement | undefined = terminal.scrollPort_?.iframe_;
      if (iframe) {
        iframe.style.top = '0';
        iframe.style.left = '0';
      }
    } catch { /* scrollPort_ internals may change in future hterm versions */ }

    // ── IO: push a new IO context for our app ──
    // hterm routes keystrokes to terminal.io; by pushing we get a clean context
    // on top that we control (VT can push its own IO on top of ours if needed).
    const io = terminal.io.push();
    ioRef.current = io;

    // Keystrokes → send to SSH server
    io.onVTKeystroke = (str: string) => onDataRef.current(str);
    // Paste / sendString → send to SSH server
    io.sendString = (str: string) => onDataRef.current(str);
    // Terminal resize → notify parent (send to server)
    io.onTerminalResize = (cols: number, rows: number) => {
      const last = lastSizeRef.current;
      if (last.cols === cols && last.rows === rows) return;
      lastSizeRef.current = { cols, rows };
      onResizeRef.current?.({ cols, rows });
    };

    // ── Focus / blur notifications ──
    // hterm already handles internal focus state; we additionally notify our parent.
    try {
      const screenNode = terminal.scrollPort_.getScreenNode();
      const handleFocus = () => onFocusChangeRef.current?.(true);
      const handleBlur = () => onFocusChangeRef.current?.(false);
      screenNode.addEventListener('focus', handleFocus);
      screenNode.addEventListener('blur', handleBlur);
    } catch { /* scrollPort may not be ready immediately */ }

    // ── Initial size sync ──
    // Use rAF so the DOM is fully laid out and the iframe has its final size.
    requestAnimationFrame(() => {
      applyAppearance();
      syncSize();
    });

    // ── ResizeObserver: keep terminal cols/rows in sync with container ──
    resizeObserverRef.current = new ResizeObserver(() => syncSize());
    resizeObserverRef.current.observe(host);

    return () => {
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      try { terminal.uninstallKeyboard(); } catch { /* ignore */ }
      // hterm has no dispose(); clear the host manually.
      try { host.innerHTML = ''; } catch { /* ignore */ }
      ioRef.current = null;
      termRef.current = null;
    };
    // Intentionally empty deps: terminal lifecycle is mount-once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-apply appearance whenever settings change
  useEffect(() => {
    if (termRef.current) applyAppearance();
  }, [applyAppearance, settings]);

  // ── Public handle ───────────────────────────────────────────────────────────
  useImperativeHandle(ref, () => ({
    write(data: string) {
      if (!data || !termRef.current) return;
      // Coalesce rapid writes into one interpret() call per animation frame.
      // This avoids running hterm's VT parser and scheduling many redundant
      // redraws when the server sends multiple WebSocket messages in one JS turn.
      writeBufRef.current += data;
      if (writeRafRef.current === null) {
        writeRafRef.current = requestAnimationFrame(() => {
          writeRafRef.current = null;
          const buf = writeBufRef.current;
          writeBufRef.current = '';
          if (buf && termRef.current) {
            termRef.current.interpret(buf);
          }
        });
      }
    },
    pasteText(text: string) {
      if (!text || !ioRef.current) return;
      // Normalise line endings: SSH expects \r, not \n
      let data = text.replace(/\r\n/g, '\r').replace(/\n/g, '\r');
      // If bracketed-paste mode is active hterm's paste handler already wraps
      // in \x1b[200~…\x1b[201~; sendString bypasses that wrapper,  so we add
      // it ourselves if needed.
      const term = termRef.current;
      if (term?.options_?.bracketedPaste) {
        data = '\x1b[200~' + data + '\x1b[201~';
      }
      ioRef.current.sendString(data);
    },
    clear() {
      // Cancel any pending buffered write before clearing to avoid replaying
      // stale data after the screen is wiped.
      if (writeRafRef.current !== null) {
        cancelAnimationFrame(writeRafRef.current);
        writeRafRef.current = null;
      }
      writeBufRef.current = '';
      try { termRef.current?.wipeContents(); } catch { /* ignore */ }
    },
    focus() {
      termRef.current?.focus();
    },
    syncSize,
    hasFocus() {
      try {
        const doc = termRef.current?.scrollPort_?.getDocument();
        return doc ? doc.hasFocus() : false;
      } catch {
        return false;
      }
    },
    getSelectionText() {
      try {
        return termRef.current?.getSelectionText() ?? '';
      } catch {
        return '';
      }
    },
    getVisibleText() {
      const term = termRef.current;
      if (!term) return '';
      try {
        const top = term.scrollPort_.getTopRowIndex() as number;
        const bot = term.scrollPort_.getBottomRowIndex(top) as number;
        const lines: string[] = [];
        for (let i = top; i <= bot; i++) {
          lines.push((term.getRowText(i) as string | null) ?? '');
        }
        return lines.join('\n');
      } catch {
        return '';
      }
    },
    getAllText() {
      const term = termRef.current;
      if (!term) return '';
      try {
        const total = term.getRowCount() as number;
        const lines: string[] = [];
        for (let i = 0; i < total; i++) {
          lines.push((term.getRowText(i) as string | null) ?? '');
        }
        return lines.join('\n');
      } catch {
        return '';
      }
    },
    pageUp() {
      try { termRef.current?.scrollPageUp(); } catch { /* ignore */ }
    },
    pageDown() {
      try { termRef.current?.scrollPageDown(); } catch { /* ignore */ }
    },
  }), [syncSize]);

  return (
    <div
      ref={hostRef}
      className={className ?? 'relative min-h-0 min-w-0 overflow-hidden'}
      // `position: relative` ensures this div is always the CSS containing
      // block for the absolutely-positioned hterm iframe, regardless of what
      // className the caller supplies (e.g. "h-full w-full" without "relative").
      // `contain: strict` tells the browser nothing inside affects outside layout/
      // paint; `will-change: transform` promotes this layer to GPU compositing.
      style={{ position: 'relative', contain: 'strict', willChange: 'transform' }}
    />
  );
});

export default HtermTerminal;
