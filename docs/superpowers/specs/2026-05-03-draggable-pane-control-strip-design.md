# 设计文档：窗格控制条可拖动

**日期**: 2026-05-03  
**文件**: `src/App.tsx`（`LeafPaneView` 组件）

---

## 需求

将每个终端窗格右上角悬浮的控制条（含分屏、关闭、常用命令快捷键按钮）改为可在窗格内自由拖动，拖动后的位置跨会话持久保存。悬停显示 / 移开隐藏的现有逻辑保持不变。

---

## 当前状态

控制条位于 `LeafPaneView`（`App.tsx:251`），采用 `position: absolute; top: 50px; right: 8px`，通过 CSS `opacity-0 group-hover/pane:opacity-100` 实现悬停显示。不支持拖动。

---

## 方案：Pointer Events 手动拖拽

### 状态

在 `LeafPaneView` 内增加：

```ts
const [stripPos, setStripPos] = useState<{ x: number; y: number } | null>(() => {
  try {
    const raw = localStorage.getItem('pane-strip-pos');
    if (raw) return JSON.parse(raw);
  } catch {}
  return null; // null = 使用默认位置（右上角）
});
```

`localStorage` key `pane-strip-pos`，所有窗格共享同一偏好。

### Refs

```ts
const stripRef    = useRef<HTMLDivElement>(null);   // 控制条 DOM 节点
const paneRef     = useRef<HTMLDivElement>(null);   // 窗格容器 DOM 节点（已有 terminalRootRef，可复用）
const dragState   = useRef<{ ox: number; oy: number } | null>(null); // 拖拽起始偏移
```

### 拖拽流程

1. **`onPointerDown`**（控制条 div）
   - 调用 `e.currentTarget.setPointerCapture(e.pointerId)`
   - 记录 `dragState.current = { ox: e.clientX - currentLeft, oy: e.clientY - currentTop }`
   - 设置 `cursor: grabbing`

2. **`onPointerMove`**（同一控制条 div，捕获已激活所以事件自动路由）
   - 若 `dragState.current` 为 null 则忽略
   - 读取窗格容器 `getBoundingClientRect()`
   - 计算新坐标：`newX = e.clientX - paneRect.left - dragState.ox`，`newY = e.clientY - paneRect.top - dragState.oy`
   - Clamp：`x ∈ [8, paneWidth - stripWidth - 8]`，`y ∈ [8, paneHeight - stripHeight - 8]`（留 8px margin）
   - 调用 `setStripPos({ x: newX, y: newY })`

3. **`onPointerUp`**（同一控制条 div）
   - 清空 `dragState.current = null`
   - 写入 `localStorage.setItem('pane-strip-pos', JSON.stringify({ x, y }))`

### CSS 变更

控制条 div 当前类名包含 `top-[50px] right-2`，改为：

- 当 `stripPos` 为 `null`：保留 `top-[50px] right-2`（默认右上角）
- 当 `stripPos` 有坐标：移除 `top-[50px] right-2`，改用 `style={{ left: stripPos.x, top: stripPos.y }}`

悬停显示类（`opacity-0 group-hover/pane:opacity-100 pointer-events-none group-hover/pane:pointer-events-auto`）**不变**。

拖拽时添加 `cursor-grab` / `cursor-grabbing`（通过 `isDragging` state 切换）。

### 边界约束时机

`onPointerMove` 每次都重新读 `getBoundingClientRect()`，适配窗格大小变化（分屏拖动后尺寸改变）。

---

## 不变的内容

- 悬停显示 / 移开隐藏行为
- 控制条内部按钮的功能（分屏、关闭、命令快捷键）
- `e.stopPropagation()` 防止点击按钮时触发窗格 focus 切换

---

## 影响范围

仅修改 `src/App.tsx` 中 `LeafPaneView` 组件，约 +40 行。无新依赖。
