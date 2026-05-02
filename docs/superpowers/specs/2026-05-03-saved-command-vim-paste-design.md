# 设计文档：常用命令在 vim/vi 中插入文本

**日期：** 2026-05-03  
**状态：** 已批准

## 背景

常用命令（Saved Commands）面板中的执行按钮，目前无论终端处于何种状态，都会把命令内容当 shell 命令执行（通过 `executeCommandRef.current` 或 `executeMultilineText`）。当用户在 vim/vi 等 raw terminal 程序中点击执行时，应改为在光标处插入文本，而不是提交 shell 命令。

## 需求

- **在 shell 中**：保持现状，点击执行直接运行命令。
- **在 vim/vi（或其他 raw terminal / 直接输入模式程序）中**：在光标当前位置插入命令文本，不添加换行，不自动确认执行。

## 技术现状

`TerminalPage.tsx` 中已有两个状态/ref 反映终端程序的输入模式：

| 标志 | 含义 |
|------|------|
| `rawTerminalModeRef.current` | true = alt-screen 程序（vim/htop/less 等） |
| `ptyDirectInputModeRef.current` | true = 非 alt-screen 交互式程序（sudo/docker login 等） |

已有 `pasteTextIntoRawTerminal(text: string)` 函数：
- 调用 `shellTerminalRef.current?.pasteText(text)`
- 自动处理 bracketed paste 协议（`\x1b[200~…\x1b[201~`），vim 正确处理
- 不附加 `\r`，用户自行决定后续操作

## 设计

### 改动文件

- `src/components/TerminalPage.tsx`：仅修改 `executeSavedCommand` 函数

### 逻辑变更

在 `executeSavedCommand` 函数头部（`resetInlineComposer()` 之前）加入模式检测：

```typescript
function executeSavedCommand(cmd: SavedCommand) {
  if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

  const content = cmd.content.trim();
  if (!content) return;

  // 新增：vim/vi 或其他 raw terminal / 直接输入模式
  // 在光标处插入文本，不执行 shell 命令，不加换行
  if (rawTerminalModeRef.current || ptyDirectInputModeRef.current) {
    if (cmd.id) {
      fetch(`/api/saved-commands/${cmd.id}/usage`, { method: 'POST' }).catch(() => {});
    }
    pasteTextIntoRawTerminal(content);
    return;
  }

  // 以下为原有逻辑（不变）
  resetInlineComposer();
  if (cmd.id) {
    fetch(`/api/saved-commands/${cmd.id}/usage`, { method: 'POST' }).catch(() => {});
  }
  if (cmd.type === 'natural') {
    sendInputText(content, { forceKind: 'natural' });
  } else if (content.includes('\n')) {
    executeMultilineText(content);
  } else {
    executeCommandRef.current(content);
  }
  inputRef.current?.focus();
}
```

### 行为对比

| 场景 | 点击执行结果 |
|------|-------------|
| 正常 shell | 与现在相同，直接执行命令 |
| vim/vi（alt-screen） | 在光标处插入文本，不加换行 |
| sudo/docker login 等（直接输入模式） | 在光标处插入文本，不加换行 |
| AI 自然语言命令 + 正常 shell | 与现在相同，通过 AI 执行 |

### 不改变的内容

- shell 模式下单行/多行命令执行逻辑
- AI 自然语言命令执行逻辑
- usage count 统计（两条路径均保留）
- `pasteTextIntoRawTerminal` 函数本身
- HtermTerminal 的 `pasteText` 实现

## 测试要点

1. 正常 shell → 点击常用命令 → 命令被执行（行为不变）
2. vim 打开文件后进入 insert 模式 → 点击常用命令 → 文本出现在光标处
3. vim 在 normal 模式 → 点击常用命令 → 文本字符按 vim normal 模式处理（预期行为，用户自行管理 vim 模式）
4. 多行命令在 vim 中 → 文本完整插入，换行保留
