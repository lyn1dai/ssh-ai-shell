// ANSI escape code → HTML conversion
// Uses a simple streaming state machine so we don't need ansi-to-html at runtime

// Basic ANSI 16-color + 256-color + true-color map
const ANSI_COLORS_16: Record<number, string> = {
  30: '#4e4e4e', 31: '#ff5f5f', 32: '#5fff5f', 33: '#ffff5f',
  34: '#5f5fff', 35: '#ff5fff', 36: '#5fffff', 37: '#e4e4e4',
  90: '#7c7c7c', 91: '#ff8787', 92: '#87ff87', 93: '#ffff87',
  94: '#8787ff', 95: '#ff87ff', 96: '#87ffff', 97: '#ffffff',
  // backgrounds
  40: '#4e4e4e', 41: '#ff5f5f', 42: '#5fff5f', 43: '#ffff5f',
  44: '#5f5fff', 45: '#ff5fff', 46: '#5fffff', 47: '#e4e4e4',
  100: '#7c7c7c', 101: '#ff8787', 102: '#87ff87', 103: '#ffff87',
  104: '#8787ff', 105: '#ff87ff', 106: '#87ffff', 107: '#ffffff',
};

// ANSI 256 color cube (simplified — good enough for terminal output)
function ansi256ToHex(n: number): string {
  if (n < 16) {
    const basic = Object.entries(ANSI_COLORS_16).find(([k]) => +k === n || +k === n + 30);
    return basic ? basic[1] : '#e4e4e4';
  }
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
  if (s.bold) parts.push('font-weight:700');
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

  convert(raw: string): string {
    // Strip OSC sequences (window title, etc.)
    raw = raw.replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '');
    // Strip other non-CSI escape sequences
    raw = raw.replace(/\x1b[()][0-2B]/g, '');
    // Strip cursor movement / erase sequences (we don't emulate cursor)
    raw = raw.replace(/\x1b\[[\d;]*[ABCDEFGHJKSTfnsu]/g, '');
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
}
