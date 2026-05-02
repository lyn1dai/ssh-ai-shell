/**
 * vt100Screen.ts
 * A minimal but functional VT100/xterm screen buffer for rendering full-screen
 * interactive programs (vi, vim, htop, less, etc.) inside the React terminal.
 *
 * Supports:
 *  - 80×24 (or any size) cell grid with SGR attributes (fg/bg/bold/dim/italic/underline/reverse/blink)
 *  - Cursor movement (CUP, CUF, CUB, CUU, CUD, CNL, CPL, CHA, HVP, CR, LF, BS, HT)
 *  - Erase in line / display (EL, ED)
 *  - Scroll region (DECSTBM) + scroll up/down (SU, SD, RI, IND)
 *  - Alternate screen (1049h/l, 47h/l, 1047h/l)
 *  - Application cursor keys mode (DECCKM)
 *  - Insert/replace mode, character insert/delete (ICH, DCH)
 *  - toHTML() — renders to an HTML string using the same CSS variables as ansi.ts
 *  - keyEventToVT100() — maps browser KeyboardEvent → PTY byte sequence
 */

// ─── Color helpers (mirrors ansi.ts) ────────────────────────────────────────

function ansi256ToColor(n: number): string {
  if (n < 16) return `var(--ansi-${n})`;
  if (n > 231) {
    const grey = Math.round((n - 232) * 255 / 23);
    const h = grey.toString(16).padStart(2, '0');
    return `#${h}${h}${h}`;
  }
  const idx = n - 16;
  const b = idx % 6;
  const g = Math.floor(idx / 6) % 6;
  const r = Math.floor(idx / 36);
  const toHex = (v: number) => Math.round(v * 255 / 5).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

const ANSI16_FG: Record<number, string> = {
  30: 'var(--ansi-0)', 31: 'var(--ansi-1)', 32: 'var(--ansi-2)', 33: 'var(--ansi-3)',
  34: 'var(--ansi-4)', 35: 'var(--ansi-5)', 36: 'var(--ansi-6)', 37: 'var(--ansi-7)',
  90: 'var(--ansi-8)', 91: 'var(--ansi-9)', 92: 'var(--ansi-10)', 93: 'var(--ansi-11)',
  94: 'var(--ansi-12)', 95: 'var(--ansi-13)', 96: 'var(--ansi-14)', 97: 'var(--ansi-15)',
};
const ANSI16_BG: Record<number, string> = {
  40: 'var(--ansi-0)', 41: 'var(--ansi-1)', 42: 'var(--ansi-2)', 43: 'var(--ansi-3)',
  44: 'var(--ansi-4)', 45: 'var(--ansi-5)', 46: 'var(--ansi-6)', 47: 'var(--ansi-7)',
  100: 'var(--ansi-8)', 101: 'var(--ansi-9)', 102: 'var(--ansi-10)', 103: 'var(--ansi-11)',
  104: 'var(--ansi-12)', 105: 'var(--ansi-13)', 106: 'var(--ansi-14)', 107: 'var(--ansi-15)',
};

// ─── Cell ────────────────────────────────────────────────────────────────────

interface CellAttr {
  fg: string | null;   // CSS color string or null = default
  bg: string | null;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  reverse: boolean;
  blink: boolean;
}

interface Cell {
  ch: string;
  attr: CellAttr;
}

function defaultAttr(): CellAttr {
  return { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false, reverse: false, blink: false };
}

function blankCell(): Cell {
  return { ch: ' ', attr: defaultAttr() };
}

function cloneAttr(a: CellAttr): CellAttr {
  return { ...a };
}

// ─── SGR parser ──────────────────────────────────────────────────────────────

function applySGR(params: number[], cur: CellAttr): CellAttr {
  const a = cloneAttr(cur);
  let i = 0;
  if (params.length === 0) params = [0];
  while (i < params.length) {
    const p = params[i];
    switch (p) {
      case 0: Object.assign(a, defaultAttr()); break;
      case 1: a.bold = true; break;
      case 2: a.dim = true; break;
      case 3: a.italic = true; break;
      case 4: a.underline = true; break;
      case 5: a.blink = true; break;
      case 7: a.reverse = true; break;
      case 21: a.underline = true; break;
      case 22: a.bold = false; a.dim = false; break;
      case 23: a.italic = false; break;
      case 24: a.underline = false; break;
      case 25: a.blink = false; break;
      case 27: a.reverse = false; break;
      case 39: a.fg = null; break;
      case 49: a.bg = null; break;
      default:
        if (p >= 30 && p <= 37) { a.fg = ANSI16_FG[p]; break; }
        if (p >= 40 && p <= 47) { a.bg = ANSI16_BG[p]; break; }
        if (p >= 90 && p <= 97) { a.fg = ANSI16_FG[p]; break; }
        if (p >= 100 && p <= 107) { a.bg = ANSI16_BG[p]; break; }
        if (p === 38) {
          if (params[i+1] === 5 && params[i+2] != null) {
            a.fg = ansi256ToColor(params[i+2]); i += 2;
          } else if (params[i+1] === 2 && params[i+4] != null) {
            const toH = (v: number) => v.toString(16).padStart(2, '0');
            a.fg = `#${toH(params[i+2])}${toH(params[i+3])}${toH(params[i+4])}`; i += 4;
          }
          break;
        }
        if (p === 48) {
          if (params[i+1] === 5 && params[i+2] != null) {
            a.bg = ansi256ToColor(params[i+2]); i += 2;
          } else if (params[i+1] === 2 && params[i+4] != null) {
            const toH = (v: number) => v.toString(16).padStart(2, '0');
            a.bg = `#${toH(params[i+2])}${toH(params[i+3])}${toH(params[i+4])}`; i += 4;
          }
          break;
        }
    }
    i++;
  }
  return a;
}

// ─── VT100Screen ─────────────────────────────────────────────────────────────

export class VT100Screen {
  rows: number;
  cols: number;

  // The visible grid — flat array [row*cols + col]
  private grid: Cell[];

  // Cursor position (0-based)
  private curRow = 0;
  private curCol = 0;

  // Scroll region (inclusive, 0-based row indices)
  private scrollTop = 0;
  private scrollBot: number;

  // Current drawing attributes
  private attr: CellAttr = defaultAttr();

  // Application cursor keys mode (DECCKM)
  appCursorKeys = false;

  // Saved cursor
  private savedRow = 0;
  private savedCol = 0;
  private savedAttr: CellAttr = defaultAttr();

  // Insert mode
  private insertMode = false;

  // True once \x1b[?1049h (or 47h / 1047h) has been received
  private inAltScreen = false;

  // Buffered incomplete escape sequence
  private escBuf = '';

  constructor(rows: number, cols: number) {
    this.rows = rows;
    this.cols = cols;
    this.scrollBot = rows - 1;
    this.grid = Array.from({ length: rows * cols }, blankCell);
  }

  /** Resize the screen, preserving existing content where possible. */
  resize(rows: number, cols: number) {
    const newGrid: Cell[] = Array.from({ length: rows * cols }, blankCell);
    for (let r = 0; r < Math.min(rows, this.rows); r++) {
      for (let c = 0; c < Math.min(cols, this.cols); c++) {
        newGrid[r * cols + c] = { ...this.grid[r * this.cols + c] };
      }
    }
    this.rows = rows;
    this.cols = cols;
    this.grid = newGrid;
    this.scrollTop = 0;
    this.scrollBot = rows - 1;
    this.curRow = Math.min(this.curRow, rows - 1);
    this.curCol = Math.min(this.curCol, cols - 1);
  }

  // ── Grid helpers ──────────────────────────────────────────────────────────

  private cell(r: number, c: number): Cell {
    return this.grid[r * this.cols + c];
  }

  private setCell(r: number, c: number, cell: Cell) {
    this.grid[r * this.cols + c] = cell;
  }

  private fillRow(r: number, from: number, to: number, ch = ' ', attr?: CellAttr) {
    const a = attr ?? this.attr;
    for (let c = from; c <= to; c++) {
      this.grid[r * this.cols + c] = { ch, attr: cloneAttr(a) };
    }
  }

  private fillRegion(rFrom: number, rTo: number, cFrom: number, cTo: number, ch = ' ') {
    for (let r = rFrom; r <= rTo; r++) this.fillRow(r, cFrom, cTo, ch);
  }

  // ── Scrolling ─────────────────────────────────────────────────────────────

  /** Scroll up n lines within the scroll region (content moves up, blank lines appear at bottom). */
  private scrollUp(n = 1) {
    for (let i = 0; i < n; i++) {
      for (let r = this.scrollTop; r < this.scrollBot; r++) {
        for (let c = 0; c < this.cols; c++) {
          this.grid[r * this.cols + c] = { ...this.grid[(r + 1) * this.cols + c] };
        }
      }
      this.fillRow(this.scrollBot, 0, this.cols - 1, ' ', defaultAttr());
    }
  }

  /** Scroll down n lines within the scroll region (content moves down, blank lines at top). */
  private scrollDown(n = 1) {
    for (let i = 0; i < n; i++) {
      for (let r = this.scrollBot; r > this.scrollTop; r--) {
        for (let c = 0; c < this.cols; c++) {
          this.grid[r * this.cols + c] = { ...this.grid[(r - 1) * this.cols + c] };
        }
      }
      this.fillRow(this.scrollTop, 0, this.cols - 1, ' ', defaultAttr());
    }
  }

  // ── Cursor helpers ────────────────────────────────────────────────────────

  private clampCursor() {
    this.curRow = Math.max(0, Math.min(this.rows - 1, this.curRow));
    this.curCol = Math.max(0, Math.min(this.cols - 1, this.curCol));
  }

  private advanceCursor() {
    this.curCol++;
    if (this.curCol >= this.cols) {
      this.curCol = 0;
      this.advanceRow();
    }
  }

  private advanceRow() {
    if (this.curRow === this.scrollBot) {
      this.scrollUp(1);
    } else {
      this.curRow = Math.min(this.rows - 1, this.curRow + 1);
    }
  }

  // ── Character output ──────────────────────────────────────────────────────

  private printChar(ch: string) {
    if (this.insertMode) {
      // Shift cells right, discard last
      for (let c = this.cols - 1; c > this.curCol; c--) {
        this.grid[this.curRow * this.cols + c] = { ...this.grid[this.curRow * this.cols + c - 1] };
      }
    }
    this.setCell(this.curRow, this.curCol, { ch, attr: cloneAttr(this.attr) });
    this.advanceCursor();
  }

  // ── CSI dispatch ──────────────────────────────────────────────────────────

  private dispatchCSI(seq: string) {
    // seq is everything between \x1b[ and the final byte (exclusive of both)
    // e.g. "2J" → params=[], final='J', private=''
    const m = seq.match(/^([\x3c-\x3f]?)([\d;]*)([^\d;]*)$/);
    if (!m) return;
    const priv = m[1];     // '?' or '<' or '>' etc.
    const paramStr = m[2];
    const final = m[3];
    if (!final) return;

    const params = paramStr ? paramStr.split(';').map(s => s === '' ? 0 : parseInt(s, 10)) : [];
    const p1 = params[0] ?? 0;
    const p2 = params[1] ?? 0;

    switch (final) {
      // ── Cursor movement ──────────────────────────────────────────────────
      case 'A': // CUU — cursor up
        this.curRow = Math.max(this.scrollTop, this.curRow - Math.max(1, p1));
        break;
      case 'B': // CUD — cursor down
        this.curRow = Math.min(this.scrollBot, this.curRow + Math.max(1, p1));
        break;
      case 'C': // CUF — cursor forward
        this.curCol = Math.min(this.cols - 1, this.curCol + Math.max(1, p1));
        break;
      case 'D': // CUB — cursor backward
        this.curCol = Math.max(0, this.curCol - Math.max(1, p1));
        break;
      case 'E': // CNL — cursor next line
        this.curRow = Math.min(this.rows - 1, this.curRow + Math.max(1, p1));
        this.curCol = 0;
        break;
      case 'F': // CPL — cursor preceding line
        this.curRow = Math.max(0, this.curRow - Math.max(1, p1));
        this.curCol = 0;
        break;
      case 'G': // CHA — cursor horizontal absolute
        this.curCol = Math.min(this.cols - 1, Math.max(0, Math.max(1, p1) - 1));
        break;
      case 'H': // CUP — cursor position
      case 'f': { // HVP
        const r = Math.max(1, p1) - 1;
        const c = Math.max(1, p2) - 1;
        this.curRow = Math.min(this.rows - 1, Math.max(0, r));
        this.curCol = Math.min(this.cols - 1, Math.max(0, c));
        break;
      }
      case 'd': // VPA — vertical position absolute
        this.curRow = Math.min(this.rows - 1, Math.max(0, Math.max(1, p1) - 1));
        break;

      // ── Erase ────────────────────────────────────────────────────────────
      case 'J': // ED — erase in display
        if (p1 === 0) { // to end
          this.fillRow(this.curRow, this.curCol, this.cols - 1);
          this.fillRegion(this.curRow + 1, this.rows - 1, 0, this.cols - 1);
        } else if (p1 === 1) { // to beginning
          this.fillRow(this.curRow, 0, this.curCol);
          this.fillRegion(0, this.curRow - 1, 0, this.cols - 1);
        } else if (p1 === 2 || p1 === 3) { // entire screen
          this.fillRegion(0, this.rows - 1, 0, this.cols - 1);
        }
        break;
      case 'K': // EL — erase in line
        if (p1 === 0) this.fillRow(this.curRow, this.curCol, this.cols - 1);
        else if (p1 === 1) this.fillRow(this.curRow, 0, this.curCol);
        else if (p1 === 2) this.fillRow(this.curRow, 0, this.cols - 1);
        break;

      // ── Scroll region ────────────────────────────────────────────────────
      case 'r': // DECSTBM
        this.scrollTop = Math.max(0, Math.max(1, p1) - 1);
        this.scrollBot = Math.min(this.rows - 1, (p2 || this.rows) - 1);
        if (this.scrollTop >= this.scrollBot) { this.scrollTop = 0; this.scrollBot = this.rows - 1; }
        this.curRow = 0; this.curCol = 0;
        break;

      // ── Scroll up/down ───────────────────────────────────────────────────
      case 'S': // SU — scroll up
        this.scrollUp(Math.max(1, p1));
        break;
      case 'T': // SD — scroll down
        this.scrollDown(Math.max(1, p1));
        break;

      // ── Insert/delete ────────────────────────────────────────────────────
      case '@': { // ICH — insert blank chars
        const n = Math.max(1, p1);
        const row = this.curRow;
        const col = this.curCol;
        for (let c = this.cols - 1; c >= col + n; c--) {
          this.grid[row * this.cols + c] = { ...this.grid[row * this.cols + c - n] };
        }
        this.fillRow(row, col, Math.min(this.cols - 1, col + n - 1));
        break;
      }
      case 'P': { // DCH — delete chars
        const n = Math.max(1, p1);
        const row = this.curRow;
        const col = this.curCol;
        for (let c = col; c < this.cols - n; c++) {
          this.grid[row * this.cols + c] = { ...this.grid[row * this.cols + c + n] };
        }
        this.fillRow(row, Math.max(col, this.cols - n), this.cols - 1);
        break;
      }
      case 'L': // IL — insert lines
        this.scrollDown(Math.max(1, p1));
        break;
      case 'M': // DL — delete lines
        this.scrollUp(Math.max(1, p1));
        break;
      case 'X': // ECH — erase chars
        this.fillRow(this.curRow, this.curCol, Math.min(this.cols - 1, this.curCol + Math.max(1, p1) - 1));
        break;

      // ── SGR ───────────────────────────────────────────────────────────────
      case 'm':
        this.attr = applySGR(params, this.attr);
        break;

      // ── Save/restore cursor ──────────────────────────────────────────────
      case 's': // SCP — save cursor
        this.savedRow = this.curRow; this.savedCol = this.curCol; this.savedAttr = cloneAttr(this.attr);
        break;
      case 'u': // RCP — restore cursor
        this.curRow = this.savedRow; this.curCol = this.savedCol; this.attr = cloneAttr(this.savedAttr);
        break;

      // ── Mode set/reset ───────────────────────────────────────────────────
      case 'h':
        if (priv === '?') {
          for (const p of params) {
            if (p === 1) this.appCursorKeys = true;
            if (p === 4) this.insertMode = true;
            // 1049/47/1047 handled upstream (alt screen enter)
          }
        } else {
          for (const p of params) {
            if (p === 4) this.insertMode = true;
          }
        }
        break;
      case 'l':
        if (priv === '?') {
          for (const p of params) {
            if (p === 1) this.appCursorKeys = false;
            if (p === 4) this.insertMode = false;
          }
        } else {
          for (const p of params) {
            if (p === 4) this.insertMode = false;
          }
        }
        break;

      // ── Cursor style (DECSCUSR) ───────────────────────────────────────────
      case 'q':
        // ignore (we render our own cursor)
        break;

      // ── Tab stop / other ignored ──────────────────────────────────────────
      default:
        break;
    }
    this.clampCursor();
  }

  // ── DECSC / DECRC ─────────────────────────────────────────────────────────

  private decsc() {
    this.savedRow = this.curRow; this.savedCol = this.curCol; this.savedAttr = cloneAttr(this.attr);
  }

  private decrc() {
    this.curRow = this.savedRow; this.curCol = this.savedCol; this.attr = cloneAttr(this.savedAttr);
  }

  // ── Public write ─────────────────────────────────────────────────────────

  /**
   * Feed raw PTY output to the screen buffer.
   *
   * If `data` contains an alt-screen EXIT sequence (\x1b[?1049l / 47l / 1047l)
   * the method stops processing there and returns `{ tail: <remaining data> }`.
   * The caller should treat the tail as normal terminal output and process it
   * outside raw-terminal mode.
   *
   * Returns `{ tail: '' }` normally (all data consumed).
   */
  write(data: string): { tail: string } {
    let i = 0;
    const len = data.length;

    while (i < len) {
      const ch = data[i];

      // ── Inside an escape sequence accumulation ────────────────────────────
      if (this.escBuf) {
        this.escBuf += ch;
        i++;

        // ESC alone
        if (this.escBuf === '\x1b') continue;

        const second = this.escBuf[1];

        // ── OSC (ESC ]) — wait for BEL or ST ─────────────────────────────
        if (second === ']') {
          if (ch === '\x07' || (ch === '\\' && this.escBuf[this.escBuf.length - 2] === '\x1b')) {
            this.escBuf = '';
          }
          continue;
        }

        // ── CSI (ESC [) ────────────────────────────────────────────────────
        if (second === '[') {
          // Accumulate until final byte (0x40-0x7e)
          const code = ch.charCodeAt(0);
          if (code < 0x40 || code > 0x7e) continue;

          const inner = this.escBuf.slice(2, -1); // between [ and final
          const final = ch;

          // Check for alt-screen EXIT before processing
          if (final === 'l' && /^\?(?:1049|47|1047)$/.test(inner)) {
            this.escBuf = '';
            // Return remaining data as tail
            return { tail: data.slice(i) };
          }

          // Check for alt-screen ENTER (ignore here — caller detects these before write())
          // but still handle them so the buffer doesn't choke
          if (final === 'h' && /^\?(?:1049|47|1047)$/.test(inner)) {
            this.escBuf = '';
            continue;
          }

          this.dispatchCSI(inner + final);
          this.escBuf = '';
          continue;
        }

        // ── Two-byte ESC sequences ─────────────────────────────────────────
        if (this.escBuf.length === 2) {
          switch (second) {
            case '7': this.decsc(); break;           // DECSC
            case '8': this.decrc(); break;           // DECRC
            case 'M':                                // RI — reverse index
              if (this.curRow === this.scrollTop) this.scrollDown(1);
              else this.curRow = Math.max(0, this.curRow - 1);
              break;
            case 'D':                                // IND — index (scroll up if at bottom)
              if (this.curRow === this.scrollBot) this.scrollUp(1);
              else this.curRow = Math.min(this.rows - 1, this.curRow + 1);
              break;
            case 'E':                                // NEL — next line
              this.curCol = 0;
              if (this.curRow === this.scrollBot) this.scrollUp(1);
              else this.curRow = Math.min(this.rows - 1, this.curRow + 1);
              break;
            case 'c':                                // RIS — reset
              this.reset();
              break;
            case '(':
            case ')':
            case '*':
            case '+':
              // Character set designation — we only support ASCII, ignore
              // Need one more byte
              continue;
            case '=': // DECKPAM
            case '>': // DECKPNM
            case 'H': // HTS (horizontal tab set)
            case 'Z': // DECID
              break;
            default:
              // If second byte is character set designator prefix, wait one more
              if (this.escBuf.length === 2 && ['(', ')', '*', '+'].includes(second)) continue;
              break;
          }
          this.escBuf = '';
          continue;
        }

        // Three-byte: char-set designator (already eaten above)
        if (this.escBuf.length === 3 && ['(', ')', '*', '+'].includes(second)) {
          this.escBuf = '';
          continue;
        }

        // Catch-all: if sequence growing too long without resolving, discard
        if (this.escBuf.length > 64) this.escBuf = '';
        continue;
      }

      // ── Control characters ────────────────────────────────────────────────
      if (ch === '\x1b') {
        this.escBuf = '\x1b';
        i++;
        continue;
      }
      if (ch === '\r') {
        this.curCol = 0;
        i++;
        continue;
      }
      if (ch === '\n') {
        if (this.curRow === this.scrollBot) {
          this.scrollUp(1);
        } else {
          this.curRow = Math.min(this.rows - 1, this.curRow + 1);
        }
        i++;
        continue;
      }
      if (ch === '\b') {
        this.curCol = Math.max(0, this.curCol - 1);
        i++;
        continue;
      }
      if (ch === '\t') {
        // Advance to next 8-col tab stop
        this.curCol = Math.min(this.cols - 1, Math.floor((this.curCol + 8) / 8) * 8);
        i++;
        continue;
      }
      if (ch === '\x07') { i++; continue; } // BEL — ignore
      if (ch === '\x0e' || ch === '\x0f') { i++; continue; } // SO/SI charset — ignore
      if (ch.charCodeAt(0) < 0x20) { i++; continue; } // other C0 — ignore

      // ── Printable character ───────────────────────────────────────────────
      this.printChar(ch);
      i++;
    }

    return { tail: '' };
  }

  /** Full reset */
  reset() {
    this.grid = Array.from({ length: this.rows * this.cols }, blankCell);
    this.curRow = 0; this.curCol = 0;
    this.scrollTop = 0; this.scrollBot = this.rows - 1;
    this.attr = defaultAttr();
    this.insertMode = false;
    this.appCursorKeys = false;
    this.escBuf = '';
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  /**
   * Render the screen to an HTML string.
   * Each row is a <div> (flex row), each cell is a <span> with inline style.
   * The cursor position is overlaid via a dedicated span with a CSS class.
   *
   * @param cursorVisible whether to render the cursor highlight
   */
  toHTML(cursorVisible = true): string {
    const parts: string[] = [];

    for (let r = 0; r < this.rows; r++) {
      parts.push('<div class="vt100-row" style="display:flex;white-space:pre;">');

      let runStart = 0;
      let runAttr: CellAttr | null = null;
      let runChars = '';

      const flushRun = () => {
        if (!runChars) return;
        const style = attrToStyle(runAttr!);
        const escaped = escHtml(runChars);
        if (style) {
          parts.push(`<span style="${style}">${escaped}</span>`);
        } else {
          parts.push(`<span>${escaped}</span>`);
        }
        runChars = '';
        runAttr = null;
      };

      for (let c = 0; c < this.cols; c++) {
        const cell = this.cell(r, c);
        const isCursor = cursorVisible && r === this.curRow && c === this.curCol;

        if (isCursor) {
          flushRun();
          // Reverse the cursor cell colors
          const bgColor = cell.attr.fg ?? 'rgb(var(--tw-c-term-fg))';
          const fgColor = cell.attr.bg ?? 'rgb(var(--tw-c-bg))';
          parts.push(
            `<span class="vt100-cursor" style="background:${bgColor};color:${fgColor};">${escHtml(cell.ch)}</span>`
          );
          continue;
        }

        // Merge into run if same attr
        if (runAttr !== null && attrEqual(runAttr, cell.attr)) {
          runChars += cell.ch;
        } else {
          flushRun();
          runStart = c;
          runAttr = cell.attr;
          runChars = cell.ch;
        }
      }
      flushRun();
      parts.push('</div>');
    }

    return parts.join('');
  }

  /** Current cursor row (0-based) */
  get cursorRow() { return this.curRow; }
  /** Current cursor col (0-based) */
  get cursorCol() { return this.curCol; }
}

// ─── Style helpers ────────────────────────────────────────────────────────────

function attrEqual(a: CellAttr, b: CellAttr): boolean {
  return a.fg === b.fg && a.bg === b.bg &&
    a.bold === b.bold && a.dim === b.dim && a.italic === b.italic &&
    a.underline === b.underline && a.reverse === b.reverse && a.blink === b.blink;
}

function attrToStyle(a: CellAttr): string {
  // Default attr → no inline style needed
  if (!a.fg && !a.bg && !a.bold && !a.dim && !a.italic && !a.underline && !a.reverse && !a.blink) return '';

  const parts: string[] = [];
  let fg = a.fg;
  let bg = a.bg;

  if (a.reverse) {
    // Swap fg/bg; use defaults if null
    const tmpFg = fg ?? 'rgb(var(--tw-c-term-fg))';
    const tmpBg = bg ?? 'rgb(var(--tw-c-bg))';
    fg = tmpBg;
    bg = tmpFg;
  }

  if (fg) parts.push(`color:${fg}`);
  if (bg) parts.push(`background:${bg}`);
  if (a.bold) parts.push('font-weight:700');
  if (a.dim) parts.push('opacity:0.6');
  if (a.italic) parts.push('font-style:italic');
  if (a.underline) parts.push('text-decoration:underline');
  if (a.blink) parts.push('animation:terminal-cursor-blink 1s steps(1,end) infinite');
  return parts.join(';');
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── Key event → VT100 sequence ───────────────────────────────────────────────

/**
 * Map a browser KeyboardEvent to the byte sequence that should be sent to the PTY.
 * Returns empty string for keys that should be handled at a higher level (e.g. Ctrl+C).
 *
 * @param e    The KeyboardEvent
 * @param appCursorKeys  Whether DECCKM is active (changes arrow key sequences)
 */
export function keyEventToVT100(e: KeyboardEvent | React.KeyboardEvent, appCursorKeys: boolean): string {
  const { key, ctrlKey, altKey, shiftKey, metaKey } = e;

  // ── Modifier-only keys ────────────────────────────────────────────────────
  if (['Control', 'Alt', 'Shift', 'Meta', 'CapsLock', 'NumLock', 'ScrollLock'].includes(key)) return '';

  // ── Function keys ─────────────────────────────────────────────────────────
  if (key === 'F1')  return '\x1bOP';
  if (key === 'F2')  return '\x1bOQ';
  if (key === 'F3')  return '\x1bOR';
  if (key === 'F4')  return '\x1bOS';
  if (key === 'F5')  return '\x1b[15~';
  if (key === 'F6')  return '\x1b[17~';
  if (key === 'F7')  return '\x1b[18~';
  if (key === 'F8')  return '\x1b[19~';
  if (key === 'F9')  return '\x1b[20~';
  if (key === 'F10') return '\x1b[21~';
  if (key === 'F11') return '\x1b[23~';
  if (key === 'F12') return '\x1b[24~';

  // ── Navigation ────────────────────────────────────────────────────────────
  if (key === 'ArrowUp')    return appCursorKeys ? '\x1bOA' : '\x1b[A';
  if (key === 'ArrowDown')  return appCursorKeys ? '\x1bOB' : '\x1b[B';
  if (key === 'ArrowRight') return appCursorKeys ? '\x1bOC' : '\x1b[C';
  if (key === 'ArrowLeft')  return appCursorKeys ? '\x1bOD' : '\x1b[D';
  if (key === 'Home')       return appCursorKeys ? '\x1bOH' : '\x1b[H';
  if (key === 'End')        return appCursorKeys ? '\x1bOF' : '\x1b[F';
  if (key === 'Insert')     return '\x1b[2~';
  if (key === 'Delete')     return '\x1b[3~';
  if (key === 'PageUp')     return '\x1b[5~';
  if (key === 'PageDown')   return '\x1b[6~';

  // ── Special keys ─────────────────────────────────────────────────────────
  if (key === 'Enter')     return '\r';
  if (key === 'Backspace') return ctrlKey ? '\x08' : '\x7f';
  if (key === 'Escape')    return '\x1b';
  if (key === 'Tab')       return shiftKey ? '\x1b[Z' : '\t';

  // ── Ctrl+letter ───────────────────────────────────────────────────────────
  if (ctrlKey && !altKey && !metaKey && key.length === 1) {
    const lower = key.toLowerCase();
    const code = lower.charCodeAt(0);
    if (code >= 0x61 && code <= 0x7a) {
      return String.fromCharCode(code - 0x60);
    }
    if (key === '@' || key === '`') return '\x00';
    if (key === '[') return '\x1b';
    if (key === '\\') return '\x1c';
    if (key === ']') return '\x1d';
    if (key === '^') return '\x1e';
    if (key === '_') return '\x1f';
  }

  // ── Alt+key ───────────────────────────────────────────────────────────────
  if (altKey && !ctrlKey && key.length === 1) {
    return '\x1b' + key;
  }

  // ── Printable characters ──────────────────────────────────────────────────
  if (key.length === 1 && !metaKey) {
    return key;
  }

  return '';
}
