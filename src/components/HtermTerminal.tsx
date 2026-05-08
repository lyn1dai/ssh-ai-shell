import React, {
  forwardRef, useCallback, useEffect, useImperativeHandle, useRef,
} from 'react';
import { hterm } from 'hterm/public';
import type { TerminalSettings } from '../types';
import { readClipboardText } from '../utils/clipboard';

export interface HtermTerminalHandle {
  write: (data: string) => void;
  pasteText: (text: string) => void;
  clear: () => void;
  cancelPendingWrites: () => void;
  /** Send raw bytes to the PTY (same path as keyboard input). */
  sendData: (data: string) => void;
  /** Notify hterm whether a full-screen TUI (vim etc.) is running. */
  setRawMode: (raw: boolean) => void;
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
  onData: (data: string, encoding?: 'text' | 'base64') => void;
  onPasteText?: (text: string) => void;
  onResize?: (size: { cols: number; rows: number }) => void;
  onFocusChange?: (focused: boolean) => void;
  /** Called whenever the terminal sends a scroll event to the PTY (raw mode). */
  onVimScroll?: (direction: 'up' | 'down') => void;
  className?: string;
}

function byteStringToBase64(value: string): string {
  // btoa() only handles Latin-1 (code points 0-255).
  // If the string contains characters outside that range (e.g. raw Unicode
  // such as Chinese that was NOT yet encoded by keyboard.encode), we fall back
  // to a proper UTF-8 → binary string pipeline so btoa always gets Latin-1.
  try {
    return btoa(value);
  } catch {
    const bytes = new TextEncoder().encode(value);
    let binary = '';
    bytes.forEach(b => { binary += String.fromCharCode(b); });
    return btoa(binary);
  }
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
  { settings, onData, onPasteText, onResize, onFocusChange, onVimScroll, className },
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
  // Whether a full-screen TUI (vim, less…) is currently running
  const rawModeRef = useRef(false);

  // Keep callback refs current so the stable closure below always calls the latest version
  const onDataRef = useRef(onData);
  const onPasteTextRef = useRef(onPasteText);
  const onResizeRef = useRef(onResize);
  const onFocusChangeRef = useRef(onFocusChange);
  const onVimScrollRef = useRef(onVimScroll);
  const settingsRef = useRef(settings);

  useEffect(() => { onDataRef.current = onData; }, [onData]);
  useEffect(() => { onPasteTextRef.current = onPasteText; }, [onPasteText]);
  useEffect(() => { onResizeRef.current = onResize; }, [onResize]);
  useEffect(() => { onVimScrollRef.current = onVimScroll; }, [onVimScroll]);
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
    terminal.config.set('scrollbar-visible', true);
    terminal.config.set('scroll-on-output', false);
    terminal.config.set('scroll-on-keystroke', true);
    // Keep Ctrl+C as a host key so shells still receive SIGINT, but let hterm
    // handle paste shortcuts.  This makes Ctrl+V/Shift+Insert behave like a
    // terminal paste instead of sending a literal ^V into apps like Vim.
    terminal.config.set('ctrl-c-copy', false);
    terminal.config.set('ctrl-v-paste', true);
    terminal.config.set('shift-insert-paste', true);
    terminal.config.set('send-encoding', 'utf-8');
    // Don't let hterm zoom in/out with Ctrl +/-
    terminal.config.set('ctrl-plus-minus-zero-zoom', false);
    terminal.config.set('color-palette-overrides', readAnsiPalette());

    // ── Attach to DOM ──
    // setWidth/setHeight(null) → div.style.width/height = '100%' → fills container
    terminal.decorate(host);
    terminal.setWidth(null);
    terminal.setHeight(null);
    terminal.installKeyboard();

    // ── Re-apply observer-dependent config after decorate() ──────────────────
    // hterm registers its config observer inside decorate().  Any config.set()
    // call made BEFORE decorate() stores the value but does NOT fire the
    // observer, so properties like keyboard.ctrlVPaste are never updated from
    // their defaults.  Re-applying these values here ensures the observer fires
    // and the keyboard object is correctly configured.
    terminal.config.set('ctrl-v-paste', true);      // → keyboard.ctrlVPaste = true
    terminal.config.set('shift-insert-paste', true); // → keyboard.shiftInsertPaste
    terminal.config.set('send-encoding', 'utf-8');   // → keyboard.characterEncoding

    // ── Kill ALL possible sources of left-offset ──────────────────────────────
    //
    // 1. Anchor the iframe at (0,0).  hterm creates it as `position:absolute`
    //    with no `top`/`left`, relying on the browser's static-position
    //    fallback.  On some browsers / zoom levels this introduces a fractional
    //    or full character-width gap on the left.
    try {
      const iframe: HTMLIFrameElement | undefined = terminal.scrollPort_?.iframe_;
      if (iframe) {
        iframe.style.top = '0';
        iframe.style.left = '0';
      }
    } catch { /* ignore */ }

    // 2. Patch scrollPort_.syncRowNodesDimensions_ to always set left:0.
    //    hterm normally sets rowNodes_.style.left = screen_.offsetLeft + 'px'.
    //    If screen_.offsetLeft is non-zero (RTL scrollbar quirk, browser
    //    reflow timing, etc.) every row is shifted right by that amount,
    //    making column-0 content (line numbers, ~, etc.) appear indented.
    //    Forcing left:'0px' ensures column 0 always renders at the
    //    left edge of the iframe viewport.
    try {
      const sp = terminal.scrollPort_;
      const origSync = sp.syncRowNodesDimensions_.bind(sp);
      sp.syncRowNodesDimensions_ = function (this: typeof sp) {
        origSync();
        if (this.rowNodes_) this.rowNodes_.style.left = '0px';
      };
      // Immediately reset in case resize() already ran during decorate().
      if (sp.rowNodes_) sp.rowNodes_.style.left = '0px';
    } catch { /* ignore */ }

    // 3. Inject iframe-body CSS to hard-zero any residual margin/padding on
    //    the x-screen element itself, and to force a visible scrollbar.
    //    Modern Electron/Chromium uses overlay scrollbars by default — they
    //    are invisible until hovered.  Providing explicit ::-webkit-scrollbar
    //    rules opts out of overlay behaviour and gives us a themed scrollbar
    //    that is always visible whenever there is content to scroll.
    try {
      const iframeDoc: Document | undefined = terminal.scrollPort_?.document_;
      if (iframeDoc) {
        const s = iframeDoc.createElement('style');
        s.textContent = [
          'x-screen{margin-left:0!important;padding-left:0!important;}',
          // Force a persistent (non-overlay) scrollbar styled for dark terminals.
          'x-screen::-webkit-scrollbar{width:8px;}',
          'x-screen::-webkit-scrollbar-track{background:transparent;}',
          'x-screen::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.25);border-radius:4px;}',
          'x-screen::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,0.45);}',
        ].join('');
        iframeDoc.head.appendChild(s);
      }
    } catch { /* ignore */ }

    // ── IO: push a new IO context for our app ──
    // hterm routes keystrokes to terminal.io; by pushing we get a clean context
    // on top that we control (VT can push its own IO on top of ours if needed).
    const io = terminal.io.push();
    ioRef.current = io;

    // Keep normal keyboard/device traffic on the existing text path.
    // Only the app's explicit pasteText() helper uses the byte-safe base64
    // transport, which fixes pasted Chinese without changing regular typing.
    io.onVTKeystroke = (str: string) => onDataRef.current(str, 'text');
    io.sendString = (str: string) => onDataRef.current(str, 'text');
    // Terminal resize → notify parent (send to server)
    io.onTerminalResize = (cols: number, rows: number) => {
      const last = lastSizeRef.current;
      if (last.cols === cols && last.rows === rows) return;
      lastSizeRef.current = { cols, rows };
      onResizeRef.current?.({ cols, rows });
    };

    // ── Focus / blur notifications ──
    // hterm already handles internal focus state; we additionally notify our parent.
    let screenNode: HTMLElement | null = null;
    const handleFocus = () => onFocusChangeRef.current?.(true);
    const handleBlur = () => onFocusChangeRef.current?.(false);
    const handlePasteCapture = (event: ClipboardEvent) => {
      const text = event.clipboardData?.getData('text') ?? '';
      event.preventDefault();
      event.stopPropagation();
      if (text) {
        onPasteTextRef.current?.(text);
        return;
      }
      // In Electron, clipboard data inside an iframe is often empty because the
      // paste event originates from the iframe's sandboxed document and the
      // clipboardData object is unpopulated.  Fall back to the async clipboard
      // API which has access to the system clipboard regardless of frame context.
      readClipboardText().then(t => {
        onPasteTextRef.current?.(t ?? '');
      }).catch(() => {
        // No clipboard access at all — still invoke the handler so the parent
        // can open the pasteboard panel for the user to paste manually.
        onPasteTextRef.current?.('');
      });
    };
    try {
      screenNode = terminal.scrollPort_.getScreenNode();
      if (screenNode) {
        screenNode.addEventListener('focus', handleFocus);
        screenNode.addEventListener('blur', handleBlur);
        screenNode.addEventListener('paste', handlePasteCapture, true);
      }
    } catch { /* scrollPort may not be ready immediately */ }

    // ── Fix: forward mouse-wheel events to the PTY when mouse reporting is on ──
    //
    // hterm bug: reportMouseEvents_ starts false and is never set true for
    // wheel events, so onMouse_() silently drops them even when vim (or any
    // other TUI) has enabled X10 mouse reporting with \x1b[?1000h or 1002h.
    // We override the public onScrollWheel hook that onScrollWheel_() calls
    // before doing its own scrollback scroll.  Calling e.preventDefault()
    // here causes onScrollWheel_() to return early, so scrollback is not moved.
    try {
      const sp = terminal.scrollPort_;
      sp.onScrollWheel = (e: Event) => {
        const we = e as WheelEvent;

        // ── Keyboard fallback (works without `set mouse=a`) ──────────────────
        // When a full-screen TUI is active but hasn't enabled X10 mouse
        // reporting, convert the wheel event into arrow keystrokes so vim (and
        // other TUI apps) scroll without requiring any server-side vimrc change.
        if (terminal.vt.mouseReport === terminal.vt.MOUSE_REPORT_DISABLED) {
          if (!rawModeRef.current) return; // shell mode → let hterm scroll normally
          const dir = we.deltaY < 0 ? 'up' : 'down';
          // Send enough arrow keys to guarantee the cursor leaves the visible area
          // (forcing the viewport to scroll). Use rows/4 so the count adapts to
          // terminal height; minimum 10 so small terminals still scroll visibly.
          const rows = lastSizeRef.current.rows || 24;
          const repeatCount = Math.max(10, Math.ceil(rows / 4));
          const seq = (dir === 'up' ? '\x1b[A' : '\x1b[B').repeat(repeatCount);
          onDataRef.current(seq, 'text');
          onVimScrollRef.current?.(dir);  // notify TerminalPage to update thumb
          we.preventDefault();
          return;
        }

        // ── X10 mouse protocol (vim has `set mouse=a`) ───────────────────────
        const charH: number = sp.characterSize?.height || 16;
        const charW: number = sp.characterSize?.width  ||  8;

        // Terminal coordinates are 1-based; X10 encodes them as (coord + 32).
        // Use offsetX/Y (relative to x-screen element) rather than clientX/Y
        // (relative to iframe viewport) to correctly handle any internal padding.
        const col = Math.min(255, Math.max(33, Math.floor((we as any).offsetX / charW) + 1 + 32));
        const row = Math.min(255, Math.max(33, Math.floor((we as any).offsetY / charH) + 1 + 32));

        // deltaY < 0 ↔ wheel scrolled UP ↔ X10 button 96 (scroll-up)
        // deltaY > 0 ↔ wheel scrolled DOWN ↔ X10 button 97 (scroll-down)
        const scrollingUp = we.deltaY < 0;
        let b = (scrollingUp ? 0 : 1) + 96; // 96 = scroll-up, 97 = scroll-down
        if (we.shiftKey) b |= 4;
        if (we.metaKey)  b |= 8;
        if (we.ctrlKey)  b |= 16;

        // \x1b[M <b> <col> <row>  — classic X10 mouse encoding
        const seq = '\x1b[M'
          + String.fromCharCode(b)
          + String.fromCharCode(col)
          + String.fromCharCode(row);
        onDataRef.current(seq, 'text');
        onVimScrollRef.current?.(scrollingUp ? 'up' : 'down');  // update thumb

        // Prevent onScrollWheel_() from moving the scrollback buffer.
        we.preventDefault();
      };
    } catch { /* ignore */ }

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
      if (screenNode) {
        screenNode.removeEventListener('focus', handleFocus);
        screenNode.removeEventListener('blur', handleBlur);
        screenNode.removeEventListener('paste', handlePasteCapture, true);
      }
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
      const term = termRef.current;
      const io = ioRef.current;
      if (!text || !term || !io) return;

      // Mirror hterm's native paste pipeline so keyboard shortcuts and our
      // programmatic paste path produce identical bytes on the wire.
      let data = text
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/\n/g, '\r');
      if (typeof term.keyboard?.encode === 'function') {
        data = term.keyboard.encode(data);
      }
      if (term?.options_?.bracketedPaste) {
        data = '\x1b[200~' + data + '\x1b[201~';
      }
      onDataRef.current(byteStringToBase64(data), 'base64');
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
    // Like clear() but does NOT wipe the terminal screen or scrollback buffer.
    // Used when entering raw-terminal mode (vim etc.) so that the pre-vim
    // output remains in hterm's scrollback and the user can scroll back to it
    // using the scrollbar while vim is running.
    cancelPendingWrites() {
      if (writeRafRef.current !== null) {
        cancelAnimationFrame(writeRafRef.current);
        writeRafRef.current = null;
      }
      writeBufRef.current = '';
    },
    sendData(data: string) {
      if (data) onDataRef.current(data, 'text');
    },
    setRawMode(raw: boolean) {
      rawModeRef.current = raw;
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
