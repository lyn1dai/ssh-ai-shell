# 常用命令 vim/vi 插入文本 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 当终端处于 vim/vi 或其他 raw terminal 程序中时，点击常用命令的执行按钮，将命令文本在光标处插入，而不是作为 shell 命令执行。

**Architecture:** 仅修改 `executeSavedCommand` 函数，在函数头部检测 `rawTerminalModeRef.current || ptyDirectInputModeRef.current`，若为 true 则调用已有的 `pasteTextIntoRawTerminal(content)` 并提前返回；其余逻辑完全不变。

**Tech Stack:** React, TypeScript，无需新增依赖。

---

### Task 1: 修改 executeSavedCommand 函数

**Files:**
- Modify: `src/components/TerminalPage.tsx:2139-2160`

- [ ] **Step 1: 查看当前函数（确认行号未偏移）**

打开 `src/components/TerminalPage.tsx`，找到 `executeSavedCommand` 函数，确认它从大约第 2139 行开始，内容如下：

```typescript
function executeSavedCommand(cmd: SavedCommand) {
  if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

  const content = cmd.content.trim();
  if (!content) return;
  resetInlineComposer();

  // Track usage count (fire-and-forget)
  if (cmd.id) {
    fetch(`/api/saved-commands/${cmd.id}/usage`, { method: 'POST' }).catch(() => {});
  }

  if (cmd.type === 'natural') {
    sendInputText(content, { forceKind: 'natural' });
  } else if (content.includes('\n')) {
    executeMultilineText(content);
  } else {
    // Single-line: go through normal executeCommand so prompt echo + waiting state work
    executeCommandRef.current(content);
  }
  inputRef.current?.focus();
}
```

- [ ] **Step 2: 将函数替换为新版本**

将上述函数整体替换为：

```typescript
function executeSavedCommand(cmd: SavedCommand) {
  if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

  const content = cmd.content.trim();
  if (!content) return;

  // Track usage count (fire-and-forget)
  if (cmd.id) {
    fetch(`/api/saved-commands/${cmd.id}/usage`, { method: 'POST' }).catch(() => {});
  }

  // In vim/vi or other raw-terminal / direct-input programs: paste text at cursor,
  // do NOT run as a shell command, do NOT append a newline.
  if (rawTerminalModeRef.current || ptyDirectInputModeRef.current) {
    pasteTextIntoRawTerminal(content);
    return;
  }

  resetInlineComposer();

  if (cmd.type === 'natural') {
    sendInputText(content, { forceKind: 'natural' });
  } else if (content.includes('\n')) {
    executeMultilineText(content);
  } else {
    // Single-line: go through normal executeCommand so prompt echo + waiting state work
    executeCommandRef.current(content);
  }
  inputRef.current?.focus();
}
```

关键变更：
1. `resetInlineComposer()` 移到 usage count 之后，raw terminal 分支之后（raw 模式下不需要重置 inline composer）
2. 新增 `rawTerminalModeRef.current || ptyDirectInputModeRef.current` 检测，调用 `pasteTextIntoRawTerminal(content)` 后提前 return

- [ ] **Step 3: 构建项目，确认无 TypeScript 错误**

```bash
npm run build
```

预期：构建成功，无 TypeScript 错误，无 lint 警告（如有关于 deps 的 eslint 提示可忽略）。

- [ ] **Step 4: 手动测试 — shell 模式（回归验证）**

启动开发服务：
```bash
npm run dev
```

1. 连接 SSH
2. 打开常用命令面板，新建一个 shell 命令，例如 `echo hello`
3. 确认终端处于普通 shell 状态（无程序运行）
4. 点击该命令的执行按钮

**预期结果：** 命令被执行，终端输出 `hello`，行为与之前完全一致。

- [ ] **Step 5: 手动测试 — vim 模式**

1. 在终端执行 `vim /tmp/test.txt`（或任意文件），vim 启动
2. 按 `i` 进入 insert 模式
3. 在常用命令面板中点击某个命令的执行按钮

**预期结果：** 命令文本出现在 vim 光标处，不加换行，vim 不退出，终端不执行 shell 命令。

- [ ] **Step 6: 手动测试 — vim normal 模式**

1. vim 在 normal 模式（按 Esc 确保）
2. 点击常用命令执行按钮

**预期结果：** 文本字符按 vim normal 模式快捷键处理（这是预期行为，用户需自行管理 vim 模式）。

- [ ] **Step 7: Commit**

```bash
git add src/components/TerminalPage.tsx
git commit -m "feat: paste saved command text at cursor in vim/raw-terminal mode"
```
