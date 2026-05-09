function fallbackCopyText(text: string) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(ta);
  if (!ok) throw new Error('execCommand(copy) failed');
}

export async function writeClipboardText(text: string) {
  if (window.desktopClipboard?.writeText) {
    await window.desktopClipboard.writeText(text);
    return;
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  fallbackCopyText(text);
}

export async function readClipboardText() {
  if (window.desktopClipboard?.readText) {
    return window.desktopClipboard.readText();
  }
  if (navigator.clipboard?.readText) {
    return navigator.clipboard.readText();
  }
  throw new Error('Clipboard read is unavailable');
}
