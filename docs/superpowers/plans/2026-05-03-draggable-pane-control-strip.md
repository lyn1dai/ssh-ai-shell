# Draggable Pane Control Strip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `LeafPaneView` 中的窗格控制条（含分屏/关闭按钮）可在窗格内自由拖动，位置跨会话持久保存于 `localStorage`。

**Architecture:** 在 `LeafPaneView` 内用 `useState` 维护控制条坐标，用 `useRef` 跟踪拖拽偏移，通过 Pointer Events API 实现拖动。拖动结束写入 `localStorage['pane-strip-pos']`。初始化时从 `localStorage` 恢复位置，首次使用时默认右上角（`null`）。

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Pointer Events API（原生，无新依赖）

---

## 文件变更

- **Modify:** `src/App.tsx` — 仅改动 `LeafPaneView` 函数组件（当前第 192–302 行）

---

### Task 1：添加位置状态与 Refs

**Files:**
- Modify: `src/App.tsx:192-302`（`LeafPaneView` 函数体顶部）

- [ ] **Step 1：在 `LeafPaneView` 函数体内，`pendingCmd` state 之后插入以下代码**

  在 `src/App.tsx` 第 197 行之后（`const [pendingCmd, ...]` 下方）插入：

  ```tsx
  // ── Draggable strip position ───────────────────────────────────────────
  const STRIP_POS_KEY = 'pane-strip-pos';

  const [stripPos, setStripPos] = useState<{ x: number; y: number } | null>(() => {
    try {
      const raw = localStorage.getItem(STRIP_POS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed.x === 'number' && typeof parsed.y === 'number') return parsed;
      }
    } catch {}
    return null; // null = 使用默认右上角位置
  });

  const [isDragging, setIsDragging] = useState(false);
  const paneRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const dragOffset = useRef<{ ox: number; oy: number } | null>(null);
  ```

- [ ] **Step 2：验证编译通过**

  ```
  npm run build 2>&1 | tail -20
  ```
  预期：无 TypeScript 错误（可有 warning）。

- [ ] **Step 3：Commit**

  ```bash
  git add src/App.tsx
  git commit -m "feat: add draggable strip state and refs to LeafPaneView"
  ```

---

### Task 2：将窗格容器 div 绑定 paneRef，控制条 div 绑定 stripRef

**Files:**
- Modify: `src/App.tsx:218-301`（`LeafPaneView` return JSX）

- [ ] **Step 1：给窗格容器 div 加 ref**

  找到第 219 行（`<div className="group/pane" style={{...}}`），加上 `ref={paneRef}`：

  ```tsx
  <div
    ref={paneRef}
    className="group/pane"
    style={{
      position: 'absolute',
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      overflow: 'hidden',
      outline: (hasSplit && isFocused) ? '1.5px solid rgb(var(--tw-c-blue) / 0.4)' : 'none',
      outlineOffset: '-1px',
    }}
    onMouseDown={e => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-allow-selection="true"]')) return;
      onFocusPane();
    }}
  >
  ```

- [ ] **Step 2：给控制条外层 div 加 ref 和动态 style/className**

  找到第 250 行（控制条外层 `<div className="absolute z-30 top-[50px] right-2 ...">`），替换为：

  ```tsx
  {/* Per-pane control strip — draggable top-right overlay on hover */}
  <div
    ref={stripRef}
    className={`absolute z-30 opacity-0 group-hover/pane:opacity-100 transition-opacity duration-150 pointer-events-none group-hover/pane:pointer-events-auto${isDragging ? ' cursor-grabbing' : ''}`}
    style={stripPos !== null
      ? { left: stripPos.x, top: stripPos.y }
      : { top: 50, right: 8 }}
    onPointerDown={handleStripPointerDown}
    onPointerMove={handleStripPointerMove}
    onPointerUp={handleStripPointerUp}
  >
  ```

  > 注意：`top-[50px] right-2` 这两个 Tailwind 类从 className 中移除，改为 `style` 内联控制。

- [ ] **Step 3：验证编译通过**

  ```
  npm run build 2>&1 | tail -20
  ```
  预期：报错 `handleStripPointerDown` 等函数未定义（正常，下一 task 实现）。

---

### Task 3：实现拖拽处理函数

**Files:**
- Modify: `src/App.tsx`（`LeafPaneView` 函数体，`isDragging` state 下方插入）

- [ ] **Step 1：在 `isDragging` state 声明之后插入三个拖拽处理函数**

  ```tsx
  const handleStripPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // 只响应鼠标左键；忽略点击到按钮子元素的事件（按钮自己的 onMouseDown 已 stopPropagation）
    if (e.button !== 0) return;
    const strip = stripRef.current;
    const pane  = paneRef.current;
    if (!strip || !pane) return;

    const paneRect  = pane.getBoundingClientRect();
    const stripRect = strip.getBoundingClientRect();
    dragOffset.current = {
      ox: e.clientX - stripRect.left + paneRect.left,
      oy: e.clientY - stripRect.top  + paneRect.top,
    };
    strip.setPointerCapture(e.pointerId);
    setIsDragging(true);
    e.stopPropagation(); // 防止触发窗格 focus 切换
  }, []);

  const handleStripPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragOffset.current) return;
    const pane  = paneRef.current;
    const strip = stripRef.current;
    if (!pane || !strip) return;

    const paneRect  = pane.getBoundingClientRect();
    const stripW    = strip.offsetWidth;
    const stripH    = strip.offsetHeight;
    const MARGIN    = 8;

    const rawX = e.clientX - paneRect.left - dragOffset.current.ox;
    const rawY = e.clientY - paneRect.top  - dragOffset.current.oy;

    const x = Math.max(MARGIN, Math.min(paneRect.width  - stripW - MARGIN, rawX));
    const y = Math.max(MARGIN, Math.min(paneRect.height - stripH - MARGIN, rawY));

    setStripPos({ x, y });
  }, []);

  const handleStripPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragOffset.current) return;
    dragOffset.current = null;
    setIsDragging(false);

    // 持久化位置
    setStripPos(prev => {
      if (prev) {
        try { localStorage.setItem(STRIP_POS_KEY, JSON.stringify(prev)); } catch {}
      }
      return prev;
    });
  }, []);
  ```

  > 在文件顶部 `import React, { useState, ... }` 中确认 `useCallback` 已引入（`App.tsx` 当前只 import `useState, useEffect, useRef`，需要添加 `useCallback`）。

- [ ] **Step 2：在 `App.tsx` 顶部 import 中添加 `useCallback`**

  找到第 1 行：
  ```tsx
  import React, { useState, useEffect, useRef } from 'react';
  ```
  改为：
  ```tsx
  import React, { useState, useEffect, useRef, useCallback } from 'react';
  ```

- [ ] **Step 3：验证编译通过**

  ```
  npm run build 2>&1 | tail -20
  ```
  预期：零错误。

- [ ] **Step 4：Commit**

  ```bash
  git add src/App.tsx
  git commit -m "feat: implement pointer-event drag handlers for pane control strip"
  ```

---

### Task 4：修复拖拽偏移计算（去掉多余的 paneRect 偏移）

**Files:**
- Modify: `src/App.tsx`（`handleStripPointerDown` 函数）

> `dragOffset` 的作用是记录"指针在控制条内的相对位置"，让控制条跟手移动时不跳。
> 因为 `setStripPos` 存的是相对于 **窗格** 的坐标，计算需要：
> `ox = e.clientX - paneRect.left - stripRelX`
> 其中 `stripRelX = stripRect.left - paneRect.left`
> 合并得：`ox = e.clientX - stripRect.left`（paneRect.left 抵消）

- [ ] **Step 1：修正 `handleStripPointerDown` 中的偏移计算**

  将 `handleStripPointerDown` 内的 dragOffset 赋值改为：

  ```tsx
  dragOffset.current = {
    ox: e.clientX - stripRect.left,
    oy: e.clientY - stripRect.top,
  };
  ```

  同时，`handleStripPointerMove` 中使用 `dragOffset` 的方式不变（已正确）：

  ```tsx
  const rawX = e.clientX - paneRect.left - dragOffset.current.ox;
  // 等价于 e.clientX - paneRect.left - (e0.clientX - stripRect0.left)
  // = (stripRect0.left - paneRect.left) + (e.clientX - e0.clientX)
  // 即：控制条初始相对位置 + 指针位移 ✓
  ```

- [ ] **Step 2：验证编译通过**

  ```
  npm run build 2>&1 | tail -20
  ```
  预期：零错误。

- [ ] **Step 3：Commit**

  ```bash
  git add src/App.tsx
  git commit -m "fix: correct drag offset calculation for pane control strip"
  ```

---

### Task 5：手动功能验证

**Files:** 无代码改动

- [ ] **Step 1：启动开发服务器**

  ```
  npm run dev
  ```
  浏览器打开 `http://localhost:5173`（或终端提示的端口）。

- [ ] **Step 2：验证默认位置**

  连接任意 SSH 会话，鼠标悬停到终端窗格 → 控制条应出现在右上角（top≈50px, right≈8px）。

- [ ] **Step 3：验证拖动**

  - 鼠标悬停使控制条出现
  - 在控制条**空白处**（非按钮区域）按下左键并拖动 → 控制条跟手移动
  - 松开鼠标 → 控制条停在新位置

- [ ] **Step 4：验证按钮仍可点击**

  拖到新位置后，点击"左右分屏"、"关闭"等按钮 → 功能正常，不触发拖拽。

- [ ] **Step 5：验证边界约束**

  尝试拖到窗格最左边缘、顶部、底部 → 控制条不超出窗格边界（留 8px margin）。

- [ ] **Step 6：验证持久化**

  拖到新位置后刷新页面 → 控制条恢复到上次位置。

- [ ] **Step 7：验证多窗格共享**

  分屏后在另一个窗格悬停 → 控制条出现在相同的已保存位置（共享 `localStorage` key）。

- [ ] **Step 8：Commit（如有任何遗留调整）**

  ```bash
  git add src/App.tsx
  git commit -m "feat: draggable pane control strip with localStorage persistence"
  ```

---

## 实施注意事项

1. **按钮的 `onMouseDown` 已有 `e.stopPropagation()`**（`App.tsx:261,277,284,292`），这会阻止 `mousedown` 冒泡到控制条外层 div。但拖拽用的是 `onPointerDown`，`stopPropagation` 对 pointer events 不影响，需确认按钮点击时**不会**触发拖拽——由于按钮上没有 `onPointerDown`，pointer 事件会冒泡到控制条 div，从而触发拖拽开始。

   **修复**：在控制条内层（按钮容器）div 加 `onPointerDown={e => e.stopPropagation()}`，防止点击按钮时启动拖拽：

   ```tsx
   <div
     className="flex max-w-[calc(100vw-48px)] items-center ..."
     onPointerDown={e => e.stopPropagation()}
   >
   ```

   这样拖拽区域变为控制条外层 div 的 padding 区域，实际体验是"抓住控制条边缘拖动"。

   > 如果希望整个控制条都可拖动（包括按钮区域），则不加此 `stopPropagation`，但要确保拖动距离 < 某阈值才识别为拖拽而非点击（更复杂，超出当前需求）。**推荐加 stopPropagation 的方案**。

   在 Task 3 Step 1 完成后，立即将此 `onPointerDown={e => e.stopPropagation()}` 加到内层 div。

2. **`transition-opacity` 与拖拽**：控制条有 `transition-opacity duration-150`，拖拽过程中鼠标不会离开控制条，opacity 保持 100%，无问题。

3. **窗格 resize 后坐标越界**：用户分屏后窗格变窄，控制条可能超出新边界。不需要自动修正（用户下次拖动时自然 clamp）。
