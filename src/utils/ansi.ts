// ANSI escape code → HTML conversion
// Uses a simple streaming state machine so we don't need ansi-to-html at runtime

// Basic ANSI 16-color map — references CSS variables so colors adapt with the theme.
// --ansi-0..7 = standard colors, --ansi-8..15 = bright colors (defined in index.css).
const ANSI_COLORS_16: Record<number, string> = {
  // foreground: standard (30-37) → indices 0-7
  30: 'var(--ansi-0)', 31: 'var(--ansi-1)', 32: 'var(--ansi-2)', 33: 'var(--ansi-3)',
  34: 'var(--ansi-4)', 35: 'var(--ansi-5)', 36: 'var(--ansi-6)', 37: 'var(--ansi-7)',
  // foreground: bright (90-97) → indices 8-15
  90: 'var(--ansi-8)',  91: 'var(--ansi-9)',  92: 'var(--ansi-10)', 93: 'var(--ansi-11)',
  94: 'var(--ansi-12)', 95: 'var(--ansi-13)', 96: 'var(--ansi-14)', 97: 'var(--ansi-15)',
  // background: standard (40-47) → indices 0-7
  40: 'var(--ansi-0)', 41: 'var(--ansi-1)', 42: 'var(--ansi-2)', 43: 'var(--ansi-3)',
  44: 'var(--ansi-4)', 45: 'var(--ansi-5)', 46: 'var(--ansi-6)', 47: 'var(--ansi-7)',
  // background: bright (100-107) → indices 8-15
  100: 'var(--ansi-8)',  101: 'var(--ansi-9)',  102: 'var(--ansi-10)', 103: 'var(--ansi-11)',
  104: 'var(--ansi-12)', 105: 'var(--ansi-13)', 106: 'var(--ansi-14)', 107: 'var(--ansi-15)',
};

// ANSI 256 color cube (simplified — good enough for terminal output)
function ansi256ToHex(n: number): string {
  // 0–15 are the same basic 16 colors — use theme variables for consistency
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

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
}

interface AnsiState {
  fg: string | null;
  bg: string | null;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  dim: boolean;
}

const defaultState = (): AnsiState => ({
  fg: null, bg: null, bold: false, italic: false, underline: false, dim: false,
});

function stateToStyle(s: AnsiState): string {
  const parts: string[] = [];
  if (s.fg) parts.push(`color:${s.fg}`);
  if (s.bg) parts.push(`background:${s.bg}`);
  if (s.bold) parts.push('font-weight:var(--terminal-bold-font-weight,700)');
  if (s.italic) parts.push('font-style:italic');
  if (s.underline) parts.push('text-decoration:underline');
  if (s.dim) parts.push('opacity:0.6');
  return parts.join(';');
}

function applyParams(params: number[], state: AnsiState): AnsiState {
  const s = { ...state };
  let i = 0;
  while (i < params.length) {
    const p = params[i];
    if (p === 0) { Object.assign(s, defaultState()); }
    else if (p === 1) s.bold = true;
    else if (p === 2) s.dim = true;
    else if (p === 3) s.italic = true;
    else if (p === 4) s.underline = true;
    else if (p === 22) { s.bold = false; s.dim = false; }
    else if (p === 23) s.italic = false;
    else if (p === 24) s.underline = false;
    else if (p === 39) s.fg = null;
    else if (p === 49) s.bg = null;
    else if (p >= 30 && p <= 37) s.fg = ANSI_COLORS_16[p];
    else if (p >= 40 && p <= 47) s.bg = ANSI_COLORS_16[p];
    else if (p >= 90 && p <= 97) s.fg = ANSI_COLORS_16[p];
    else if (p >= 100 && p <= 107) s.bg = ANSI_COLORS_16[p];
    else if (p === 38) {
      if (params[i + 1] === 5 && params[i + 2] != null) {
        s.fg = ansi256ToHex(params[i + 2]); i += 2;
      } else if (params[i + 1] === 2 && params[i + 4] != null) {
        const toH = (v: number) => v.toString(16).padStart(2, '0');
        s.fg = `#${toH(params[i+2])}${toH(params[i+3])}${toH(params[i+4])}`; i += 4;
      }
    } else if (p === 48) {
      if (params[i + 1] === 5 && params[i + 2] != null) {
        s.bg = ansi256ToHex(params[i + 2]); i += 2;
      } else if (params[i + 1] === 2 && params[i + 4] != null) {
        const toH = (v: number) => v.toString(16).padStart(2, '0');
        s.bg = `#${toH(params[i+2])}${toH(params[i+3])}${toH(params[i+4])}`; i += 4;
      }
    }
    i++;
  }
  return s;
}

// Stateful converter — call convert() repeatedly with streaming SSH chunks
export class AnsiConverter {
  private state: AnsiState = defaultState();
  private spanOpen = false;

  private clone(): AnsiConverter {
    const next = new AnsiConverter();
    next.state = { ...this.state };
    next.spanOpen = this.spanOpen;
    return next;
  }

  convert(raw: string): string {
    // Strip OSC sequences (window title, etc.)
    raw = raw.replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '');
    // Strip other non-CSI escape sequences
    raw = raw.replace(/\x1b[()][0-2B]/g, '');
    raw = raw.replace(/\x1b[NO][\x20-\x7E]/g, '');
    // Strip standalone ESC sequences too, otherwise their trailing byte can leak
    // into the rendered HTML as visible text (for example a lone `b`).
    raw = raw.replace(/\x1b(?!\[|\]|\(|\))[\x20-\x2F]*[\x30-\x7E]/g, '');
    // Strip non-SGR CSI sequences only; keep `...m` color/style sequences for parsing below.
    // This still removes mode toggles (h/l), cursor movement, erase, soft-reset (\x1b[!p), etc.
    raw = raw.replace(/\x1b\[[\x30-\x3F]*[\x20-\x2F]*[\x40-\x6c\x6e-\x7E]/g, '');
    // CR without LF → line end (treat as \r\n)
    raw = raw.replace(/\r(?!\n)/g, '\r\n');

    let html = '';
    // Split on CSI color sequences only
    const parts = raw.split(/(\x1b\[[\d;]*m)/);

    for (const part of parts) {
      if (part.startsWith('\x1b[') && part.endsWith('m')) {
        // Close existing span
        if (this.spanOpen) { html += '</span>'; this.spanOpen = false; }
        // Parse params
        const inner = part.slice(2, -1);
        const params = inner ? inner.split(';').map(Number) : [0];
        this.state = applyParams(params, this.state);
        // Open new span if needed
        const style = stateToStyle(this.state);
        if (style) {
          html += `<span style="${style}">`;
          this.spanOpen = true;
        }
      } else if (part) {
        // Regular text — escape HTML but preserve newlines and spaces
        let escaped = escapeHtml(part);
        // Convert \r\n → <br>, standalone \n → <br>
        escaped = escaped.replace(/\r\n/g, '\n').replace(/\r/g, '');
        escaped = escaped
          .replace(/ {2,}/g, (s) => '&nbsp;'.repeat(s.length))
          .replace(/\t/g, '&nbsp;&nbsp;&nbsp;&nbsp;');
        html += escaped;
      }
    }

    return html;
  }

  flush(): string {
    if (this.spanOpen) { this.spanOpen = false; return '</span>'; }
    return '';
  }

  renderPreview(raw: string): string {
    const preview = this.clone();
    return preview.convert(raw) + preview.flush();
  }
}
