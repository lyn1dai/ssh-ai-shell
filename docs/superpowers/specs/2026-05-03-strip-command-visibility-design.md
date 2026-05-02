# Design: Configurable Command Visibility in Floating Control Strip

**Date:** 2026-05-03  
**Status:** Approved  
**Approach:** A — `showInStrip` field on `SavedCommand`

---

## Problem

The floating control strip shows the top N saved commands ranked by `usageCount`. Users cannot opt specific commands in or out — high-frequency commands they don't want on the strip always appear, and low-frequency commands they do want never appear.

---

## Solution Overview

Add `showInStrip?: boolean` to `SavedCommand`. When `undefined` (existing data) or `true`, the command is eligible for the strip. When `false`, it is excluded. The strip still applies the existing "top N by usageCount" ranking — it simply runs over the filtered set.

Two control surfaces:

1. **Settings page** — each saved command card has a persistent Eye/EyeOff icon button showing current state; clicking toggles `showInStrip`.
2. **Floating strip** — each command button gets an `×` overlay (visible on hover) that sets `showInStrip: false`, removing it from the strip immediately.

---

## Data Model

### `src/types.ts` — `SavedCommand`

Add one optional field:

```ts
/** When false, command is excluded from the floating strip.
 *  Undefined is treated as true (shown) so existing data is unaffected. */
showInStrip?: boolean;
```

No migration needed. The filter `c.showInStrip !== false` treats `undefined` as shown.

---

## Component Changes

### `src/App.tsx` — `topCmds` computation (line 270)

Before filtering:

```ts
const topCmds = [...savedCommands]
  .sort((a, b) => (b.usageCount ?? 0) - (a.usageCount ?? 0))
  .slice(0, frequentCommandsCount);
```

After:

```ts
const topCmds = savedCommands
  .filter(c => c.showInStrip !== false)
  .sort((a, b) => (b.usageCount ?? 0) - (a.usageCount ?? 0))
  .slice(0, frequentCommandsCount);
```

### `src/App.tsx` — `removeFromStrip` helper

New async helper inside `LeafPaneView`:

```ts
async function removeFromStrip(id: string) {
  await fetch(`/api/saved-commands/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ showInStrip: false }),
  });
  window.dispatchEvent(new CustomEvent('saved-commands-updated'));
}
```

`savedCommands` is owned by the `App` component and passed as a prop to `LeafPaneView`. The existing event-driven pattern (`'saved-commands-updated'` → re-fetch in App, line 474) is the correct way to propagate the change. SettingsPage uses the same pattern (SettingsPage.tsx line 1081). No error recovery needed (strip is advisory UI, not critical state).

### `src/App.tsx` — Strip button rendering

Each command button is wrapped in a `relative group/cmd` div. An absolutely-positioned `×` button overlays the top-right corner, hidden by default, visible on `group/cmd-hover`:

```tsx
<div key={cmd.id} className="relative group/cmd">
  <button
    onMouseDown={e => { e.stopPropagation(); setPendingCmd({ cmd, nonce: Date.now() }); }}
    title={cmdTooltip(cmd)}
    className="h-6 px-1.5 flex items-center rounded-md text-terminal-muted hover:text-terminal-blue hover:bg-terminal-blue/10 transition-colors font-mono text-[10px] leading-none whitespace-nowrap"
  >
    {shortLabel(cmd.name)}
  </button>
  <button
    onMouseDown={e => { e.stopPropagation(); removeFromStrip(cmd.id); }}
    title="从悬浮栏移除"
    className="absolute -top-1 -right-1 w-3.5 h-3.5 flex items-center justify-center rounded-full bg-terminal-surface border border-terminal-border text-terminal-muted hover:text-terminal-red hover:border-terminal-red/50 transition-colors opacity-0 group-hover/cmd:opacity-100 text-[8px] leading-none"
  >
    ×
  </button>
</div>
```

The `×` badge sits at the top-right corner of the command button, compact enough to not obscure the label but clear enough to click.

### `src/components/SettingsPage.tsx` — Toggle icon in view mode

In the command card's action button group (lines ~2504-2519), add a toggle button **before** the edit button. The toggle is always visible (not hover-gated) so users can see at a glance which commands are strip-enabled.

```tsx
<button
  onClick={() => toggleStripVisibility(cmd)}
  title={cmd.showInStrip !== false ? '在悬浮栏显示（点击关闭）' : '已从悬浮栏隐藏（点击开启）'}
  className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors ${
    cmd.showInStrip !== false
      ? 'text-terminal-blue hover:bg-terminal-blue/10'
      : 'text-terminal-muted hover:bg-terminal-border/40 hover:text-terminal-text'
  }`}
>
  {cmd.showInStrip !== false
    ? <Eye className="w-3.5 h-3.5" />
    : <EyeOff className="w-3.5 h-3.5" />}
</button>
```

`Eye` and `EyeOff` are already available in `lucide-react` (used elsewhere in the project).

New helper `toggleStripVisibility` in SettingsPage:

```ts
async function toggleStripVisibility(cmd: SavedCommand) {
  const next = cmd.showInStrip === false ? true : false;
  const res = await fetch(`/api/saved-commands/${cmd.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ showInStrip: next }),
  });
  if (res.ok) {
    setSavedCommands(prev =>
      prev.map(c => c.id === cmd.id ? { ...c, showInStrip: next } : c)
    );
    notifyCommandsUpdated(); // propagates change to App / LeafPaneView
  }
}
```

---

## Server

No server changes required. The PUT endpoint at line 1520 merges `req.body` into the stored record:

```js
cmds[idx] = { ...cmds[idx], ...req.body };
```

Sending `{ showInStrip: false }` or `{ showInStrip: true }` is already supported.

---

## Behavior Summary

| Scenario | Result |
|---|---|
| Existing command, `showInStrip` undefined | Treated as `true`; eligible for strip |
| New command created | `showInStrip` not set; eligible by default |
| User toggles off in Settings | `showInStrip: false` persisted; excluded from strip |
| User clicks `×` on strip | Same as above; button disappears immediately |
| User toggles back on in Settings | `showInStrip: true`; eligible again |
| All commands toggled off | Strip shows 0 command buttons (strip section hidden as before) |

---

## Out of Scope

- Custom ordering of strip commands (separate feature if needed later)
- Showing `showInStrip` state in the add-command form (toggle defaults to on; user can change after creation)
- Error toast when PUT fails (consistent with existing pattern in SettingsPage that silently ignores failures)

---

## Verification

1. `npm run build` — zero TypeScript errors
2. Manual: toggle a command off in Settings → it disappears from strip
3. Manual: click `×` on a strip button → button disappears, Settings page shows EyeOff
4. Manual: toggle back on → reappears if within top N
5. Manual: existing commands with no `showInStrip` field still appear in strip
