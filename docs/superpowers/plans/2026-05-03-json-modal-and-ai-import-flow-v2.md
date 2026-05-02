# JSON Paste Modal & AI Import Flow v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the tiny inline JSON textarea with a full-screen centered modal pre-filled with template JSON, and update the AI import prompt so step 3 guides the user to either paste the copied JSON or reply "是" to import directly.

**Architecture:** Two independent tasks. Task 1 modifies `ConnectForm.tsx` (modal UI). Task 2 modifies `AIChatPanel.tsx` (prompt text only). No backend changes.

**Tech Stack:** React 18 + TypeScript + Tailwind CSS + Lucide React.

---

## Task 1: ConnectForm.tsx — Replace inline textarea with full-screen modal

**Files:**
- Modify: `src/components/ConnectForm.tsx`

---

- [ ] **Step 1: Add `TEMPLATE_JSON_EXAMPLE` constant at module scope**

Find the module-scope area near the top of the file (after the imports, around line 10). Insert this constant **before** the first helper or component (anywhere in the module scope before `export default function ConnectForm`):

```tsx
// ─── Template JSON example (same as 下载模板) ──────────────────────────────
const TEMPLATE_JSON_EXAMPLE = JSON.stringify(
  [
    { name: '示例服务器', host: '192.168.1.1', port: 22, username: 'root', password: 'your_password', privateKey: '', group: 'Production/Web' },
    { name: '开发机', host: '10.0.0.2', port: 22, username: 'ubuntu', password: '', privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\n...', group: 'Development' },
  ],
  null,
  2
);
```

- [ ] **Step 2: Update the JSON button's `onClick` to pre-fill the example on open**

Find the JSON toolbar button's `onClick` (currently at line ~1148):

```tsx
            onClick={() => { setShowJsonPaste(s => !s); setJsonPasteError(null); }}
```

Replace with:

```tsx
            onClick={() => {
              const next = !showJsonPaste;
              setShowJsonPaste(next);
              setJsonPasteError(null);
              // Pre-fill example only when opening and textarea is empty
              if (next) setJsonPasteText(prev => prev || TEMPLATE_JSON_EXAMPLE);
            }}
```

- [ ] **Step 3: Remove the inline expansion block and add a full-screen modal**

Find and **remove** the entire inline expansion (lines ~1160-1188):

```tsx
        {/* Inline JSON paste area — expands below the toolbar */}
        {showJsonPaste && (
          <div className="px-2 pb-2">
            <textarea
              value={jsonPasteText}
              onChange={e => { setJsonPasteText(e.target.value); setJsonPasteError(null); }}
              placeholder="粘贴主机 JSON（数组格式，支持多台）"
              className="w-full h-24 text-[11px] font-mono bg-terminal-bg text-terminal-text border border-terminal-border rounded p-2 resize-none focus:outline-none focus:border-terminal-blue/50"
            />
            {jsonPasteError && (
              <p className="text-[10px] text-red-400 mt-1">{jsonPasteError}</p>
            )}
            <div className="flex gap-1 mt-1">
              <button
                onClick={handleJsonPasteImport}
                disabled={!jsonPasteText.trim()}
                className="flex-1 py-1 text-[10px] bg-terminal-blue text-white rounded hover:bg-terminal-blue/80 disabled:opacity-40 transition-colors"
              >
                导入到主机列表
              </button>
              <button
                onClick={() => { setShowJsonPaste(false); setJsonPasteText(''); setJsonPasteError(null); }}
                className="px-2 py-1 text-[10px] text-terminal-muted hover:text-terminal-text rounded hover:bg-terminal-border/50 transition-colors"
              >
                取消
              </button>
            </div>
          </div>
        )}
```

Then find the **root closing `</div>`** of the ConnectForm (the one that closes `<div className="min-h-screen bg-terminal-bg flex overflow-hidden">` at line ~1024). It is currently the very last `</div>` before `);` in the return block (line ~1453). Insert the modal **just before** that closing tag:

```tsx
      {/* ── JSON Paste Import Modal ──────────────────────────────────────── */}
      {showJsonPaste && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-[80] bg-black/60"
            onClick={() => { setShowJsonPaste(false); setJsonPasteText(''); setJsonPasteError(null); }}
          />
          {/* Dialog */}
          <div className="fixed z-[81] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] max-w-[90vw] bg-terminal-surface border border-terminal-border rounded-xl shadow-2xl flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-terminal-border">
              <div>
                <h3 className="text-sm font-semibold text-terminal-text">粘贴 JSON 导入主机</h3>
                <p className="text-[11px] text-terminal-muted mt-0.5">每条记录一台主机，支持 group 子分组（如 Production/Web）</p>
              </div>
              <button
                onClick={() => { setShowJsonPaste(false); setJsonPasteText(''); setJsonPasteError(null); }}
                className="w-7 h-7 flex items-center justify-center rounded text-terminal-muted hover:text-terminal-text hover:bg-terminal-border/50 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {/* Body */}
            <div className="px-5 py-4">
              <textarea
                value={jsonPasteText}
                onChange={e => { setJsonPasteText(e.target.value); setJsonPasteError(null); }}
                className="w-full h-64 text-[12px] font-mono bg-terminal-bg text-terminal-text border border-terminal-border rounded-lg p-3 resize-y focus:outline-none focus:border-terminal-blue/50"
                spellCheck={false}
              />
              {jsonPasteError && (
                <p className="text-[11px] text-red-400 mt-2">{jsonPasteError}</p>
              )}
            </div>
            {/* Footer */}
            <div className="flex items-center justify-end gap-2 px-5 pb-4">
              <button
                onClick={() => { setShowJsonPaste(false); setJsonPasteText(''); setJsonPasteError(null); }}
                className="px-4 py-1.5 text-sm text-terminal-muted hover:text-terminal-text border border-terminal-border rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleJsonPasteImport}
                disabled={!jsonPasteText.trim()}
                className="px-4 py-1.5 text-sm bg-terminal-blue text-white rounded-lg hover:bg-terminal-blue/80 disabled:opacity-40 transition-colors"
              >
                导入到主机列表
              </button>
            </div>
          </div>
        </>
      )}
```

- [ ] **Step 4: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: only pre-existing errors (`SettingsPage.tsx` duplicate `ok`, `TerminalPage.tsx` missing `.d.ts`). No new errors.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/components/ConnectForm.tsx
git commit -m "feat: replace JSON paste inline textarea with full-screen modal"
```

---

## Task 2: AIChatPanel.tsx — Update HOST_IMPORT_PROMPT

**Files:**
- Modify: `src/components/AIChatPanel.tsx`

---

- [ ] **Step 1: Replace HOST_IMPORT_PROMPT constant**

Find the current constant (lines ~43-46):

```tsx
const HOST_IMPORT_PROMPT = `请帮我把主机导入到主机列表。
步骤一：请询问我主机信息（支持多台主机）。
步骤二：根据我的回复，生成一个 JSON 数组，每条记录包含以下字段：name（显示名称）、host（主机地址）、port（端口，默认22）、username（用户名）、password（密码，可选）、privateKey（私钥，可选）、group（分组，可选）。请将 JSON 放在 \`\`\`json 代码块中。
步骤三：询问我是否要一键导入到主机列表。`;
```

Replace with:

```tsx
const HOST_IMPORT_PROMPT = `请帮我把主机导入到主机列表。
步骤一：请询问我主机信息（支持多台主机）。
步骤二：根据我的回复，生成标准格式的 JSON 数组，放在 \`\`\`json 代码块中。每条记录包含以下字段：name（显示名称）、host（主机地址）、port（端口，默认22）、username（用户名）、password（密码，可选）、privateKey（私钥路径或内容，可选）、group（分组，可选，支持子分组，如 "Production/Web"）。
步骤三：在 JSON 代码块之后，直接说：「您有两种方式导入到主机列表：① 点击下方「复制 JSON」按钮，然后在主机列表底部点击「JSON」按钮粘贴导入；② 或者直接回复「是」，我来帮您一键导入。」`;
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: same pre-existing errors only. No new errors.

- [ ] **Step 3: Commit Task 2**

```bash
git add src/components/AIChatPanel.tsx
git commit -m "feat: update AI import prompt to guide user on both import methods"
```

---

## Completion Verification

Manual smoke tests:

1. **Modal opens**: Click "JSON" in sidebar toolbar → full-screen modal appears, centered, with dark backdrop
2. **Pre-filled example**: Textarea contains the 2-entry template JSON; user can edit it freely
3. **Backdrop closes**: Click outside dialog → modal closes, textarea resets
4. **Import works**: Edit to valid JSON, click "导入到主机列表" → success toast, host list refreshes, modal closes
5. **Invalid JSON**: Enter invalid JSON, click import → error message shown inline, modal stays open
6. **Re-open keeps content**: Close via ✕, re-open → textarea is empty (reset on close), then pre-fills with example again
7. **AI flow step 3**: In AI chat, after giving host info, AI generates JSON and then says the new guide message with both import options
8. **Copy + paste flow**: Click "复制 JSON" action button → JSON copied; open JSON modal → it's empty initially → paste the JSON → import succeeds
