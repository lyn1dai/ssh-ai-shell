# Strip Command Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users control which saved commands appear in the floating control strip via a per-command toggle in Settings and a quick-remove button on the strip itself.

**Architecture:** Add `showInStrip?: boolean` to `SavedCommand`. The strip's `topCmds` computation filters to eligible commands before sorting and slicing. Two UI surfaces update the field: an Eye/EyeOff toggle button in SettingsPage, and an `×` overlay button on each strip command.

**Tech Stack:** React 18, TypeScript, Tailwind CSS v3, Vite; no automated test framework — verification is `npm run build` (zero TS errors) + manual browser test.

---

## File Map

| File | Change |
|---|---|
| `src/types.ts` | Add `showInStrip?: boolean` to `SavedCommand` |
| `src/App.tsx` | Filter `topCmds`, add `removeFromStrip`, wrap strip buttons with `×` overlay |
| `src/components/SettingsPage.tsx` | Add `toggleStripVisibility`, add Eye/EyeOff button in command card view mode |

---

## Task 1: Extend `SavedCommand` type and filter `topCmds`

**Files:**
- Modify: `src/types.ts:228` (after `usageCount?`)
- Modify: `src/App.tsx:270-272`

- [ ] **Step 1: Add `showInStrip` field to the `SavedCommand` interface**

  In `src/types.ts`, after line 228 (`usageCount?: number;`), add:

  ```ts
  /** When false, excluded from the floating strip.
   *  Undefined is treated as true so existing data is unaffected. */
  showInStrip?: boolean;
  ```

  The full interface becomes:
  ```ts
  export interface SavedCommand {
    id: string;
    name: string;
    content: string;
    type: 'shell' | 'natural';
    description?: string;
    shortcut?: string;
    usageCount?: number;
    /** When false, excluded from the floating strip.
     *  Undefined is treated as true so existing data is unaffected. */
    showInStrip?: boolean;
    createdAt: string;
    updatedAt?: string;
  }
  ```

- [ ] **Step 2: Update `topCmds` computation in `src/App.tsx`**

  Current code at lines 270-272:
  ```ts
  const topCmds = [...savedCommands]
    .sort((a, b) => (b.usageCount ?? 0) - (a.usageCount ?? 0))
    .slice(0, frequentCommandsCount);
  ```

  Replace with:
  ```ts
  // Only show commands where showInStrip is not explicitly false
  const topCmds = savedCommands
    .filter(c => c.showInStrip !== false)
    .sort((a, b) => (b.usageCount ?? 0) - (a.usageCount ?? 0))
    .slice(0, frequentCommandsCount);
  ```

- [ ] **Step 3: Build and verify zero TypeScript errors**

  ```bash
  npm run build
  ```

  Expected: build succeeds with no errors. If TS errors appear, fix them before continuing.

- [ ] **Step 4: Commit**

  ```bash
  git add src/types.ts src/App.tsx
  git commit -m "feat: add showInStrip field to SavedCommand and filter topCmds"
  ```

---

## Task 2: Add `removeFromStrip` helper and `×` overlay on strip buttons

**Files:**
- Modify: `src/App.tsx` — add helper after `cmdTooltip`, update strip JSX

- [ ] **Step 1: Add `removeFromStrip` helper inside `LeafPaneView`**

  In `src/App.tsx`, after the `cmdTooltip` function (around line 285), add:

  ```ts
  // Remove a command from the strip by setting showInStrip: false.
  // Uses the event-bus pattern so App re-fetches and updates the prop.
  async function removeFromStrip(id: string) {
    await fetch(`/api/saved-commands/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ showInStrip: false }),
    });
    window.dispatchEvent(new CustomEvent('saved-commands-updated'));
  }
  ```

- [ ] **Step 2: Wrap each strip command button in a hover group with `×` overlay**

  Current strip rendering in `src/App.tsx` (lines 348-360):
  ```tsx
  {topCmds.map(cmd => (
    <button
      key={cmd.id}
      onMouseDown={e => {
        e.stopPropagation();
        setPendingCmd({ cmd, nonce: Date.now() });
      }}
      title={cmdTooltip(cmd)}
      className="h-6 px-1.5 flex items-center rounded-md text-terminal-muted hover:text-terminal-blue hover:bg-terminal-blue/10 transition-colors font-mono text-[10px] leading-none whitespace-nowrap"
    >
      {shortLabel(cmd.name)}
    </button>
  ))}
  ```

  Replace with:
  ```tsx
  {topCmds.map(cmd => (
    <div key={cmd.id} className="relative group/cmd">
      <button
        onMouseDown={e => {
          e.stopPropagation();
          setPendingCmd({ cmd, nonce: Date.now() });
        }}
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
  ))}
  ```

  Note: `group/cmd` and `group-hover/cmd:` are Tailwind v3 named-group syntax, already used elsewhere in this file (`group/pane`).

- [ ] **Step 3: Build and verify zero TypeScript errors**

  ```bash
  npm run build
  ```

  Expected: build succeeds with no errors.

- [ ] **Step 4: Manual verification**

  Start the dev server and open the app:
  1. Have at least one saved command with usage count > 0 so it appears in the strip.
  2. Hover over a strip command button — a small `×` badge should appear at the top-right corner.
  3. Click `×` — the command should disappear from the strip immediately.
  4. Reload the page — the command should still be absent from the strip (persisted).

- [ ] **Step 5: Commit**

  ```bash
  git add src/App.tsx
  git commit -m "feat: add remove-from-strip button on floating strip commands"
  ```

---

## Task 3: Add Eye/EyeOff toggle in SettingsPage command cards

**Files:**
- Modify: `src/components/SettingsPage.tsx`

- [ ] **Step 1: Add `toggleStripVisibility` helper**

  In `src/components/SettingsPage.tsx`, after `deleteSavedCommand` (around line 1140), add:

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
      notifyCommandsUpdated();
    }
  }
  ```

  `notifyCommandsUpdated` is defined at line 1080 and dispatches `'saved-commands-updated'`. `Eye` and `EyeOff` are already imported at line 5.

- [ ] **Step 2: Add the toggle button to the command card view mode**

  In `src/components/SettingsPage.tsx`, find the action buttons div in view mode (around line 2504):

  ```tsx
  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
    <button
      onClick={() => { setEditingCmd({ ...cmd }); setShowAddCmd(false); setCmdError(''); }}
      className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-terminal-border/40 text-terminal-muted hover:text-terminal-text transition-colors"
      title="编辑"
    >
      <Edit3 className="w-3.5 h-3.5" />
    </button>
    <button
      onClick={() => deleteSavedCommand(cmd.id)}
      className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-terminal-red/10 text-terminal-muted hover:text-terminal-red transition-colors"
      title="删除"
    >
      <Trash2 className="w-3.5 h-3.5" />
    </button>
  </div>
  ```

  Replace with (add the Eye/EyeOff button before the edit button; make the entire container always visible so the strip state is visible at a glance):

  ```tsx
  <div className="flex items-center gap-1 flex-shrink-0">
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
    <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
      <button
        onClick={() => { setEditingCmd({ ...cmd }); setShowAddCmd(false); setCmdError(''); }}
        className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-terminal-border/40 text-terminal-muted hover:text-terminal-text transition-colors"
        title="编辑"
      >
        <Edit3 className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={() => deleteSavedCommand(cmd.id)}
        className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-terminal-red/10 text-terminal-muted hover:text-terminal-red transition-colors"
        title="删除"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  </div>
  ```

  The Eye/EyeOff button is always visible (no opacity transition) so users can see strip status at a glance. Edit and Delete remain hover-only.

- [ ] **Step 3: Build and verify zero TypeScript errors**

  ```bash
  npm run build
  ```

  Expected: build succeeds with no errors.

- [ ] **Step 4: Manual verification**

  1. Open Settings → 常用指令.
  2. Each command card shows a blue Eye icon (strip-enabled by default).
  3. Click Eye on a command → icon turns to grey EyeOff.
  4. The command disappears from the floating strip.
  5. Click EyeOff → icon turns back to blue Eye.
  6. The command reappears in the strip (if within top N).
  7. Toggle off in Settings, then verify the strip's `×` button also reflects the state (command gone from strip).
  8. Use the strip `×` button to remove a command, then open Settings → the Eye icon for that command shows EyeOff.

- [ ] **Step 5: Commit**

  ```bash
  git add src/components/SettingsPage.tsx
  git commit -m "feat: add per-command strip visibility toggle in Settings"
  ```
