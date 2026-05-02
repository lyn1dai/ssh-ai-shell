# 设计文档：供应商级代理配置

**日期：** 2026-05-03  
**状态：** 已批准  
**范围：** `src/types.ts`、`server/index.js`、`src/components/SettingsPage.tsx`、`src/components/SettingsDialog.tsx`

---

## 背景

项目现有一个全局代理设置（存储于 `data/app-settings.json` 的 `proxy` 字段），对所有 AI 供应商生效。用户需要针对每个供应商独立控制是否走代理以及使用哪个代理地址，因为不同供应商的网络访问需求不同。

---

## 需求

1. 每个供应商配置卡片内增加代理开关（toggle）和代理地址输入框。
2. 开关打开时，该供应商的请求使用填写的代理地址。
3. 开关关闭时，该供应商直连（不走全局代理）。
4. 未配置供应商代理（旧数据/从未设置）时，回退到全局代理。
5. 两个设置入口（`SettingsPage.tsx` 主设置页 + `SettingsDialog.tsx` 弹框）均需支持。

---

## 数据模型

### `src/types.ts` — ProviderConfig 扩展

```typescript
export interface ProviderConfig {
  apiKey: string;
  baseUrl?: string;
  model: string;
  terminalModel?: string;
  enabledModels?: string[];
  apiFormat?: 'openai' | 'anthropic';
  // 新增字段
  proxy?: string;          // 供应商专属代理地址，如 "http://127.0.0.1:7890"
  proxyEnabled?: boolean;  // true=使用供应商代理，false=直连，undefined=回退全局代理
}
```

### 代理优先级规则

| `proxyEnabled` 值 | 行为 |
|---|---|
| `true` | 使用 `ProviderConfig.proxy` 地址 |
| `false` | 直连，忽略全局代理 |
| `undefined`（字段不存在） | 回退到 `appSettings.proxy`（全局代理） |

### 存储

不改变 `data/ai-settings.json` 的文件结构，`providerConfigs` 字典中每个条目自然扩展，向后兼容。

---

## 服务端逻辑（server/index.js）

新增辅助函数：

```javascript
/**
 * 根据供应商 ID 决定使用哪个代理地址。
 * @param {string} providerId - 供应商 ID，如 "openai"、"copilot"
 * @returns {string} 代理 URL 字符串，空字符串表示直连
 */
function getProxyForProvider(providerId) {
  const cfg = (aiSettings.providerConfigs || {})[providerId];
  if (cfg) {
    if (cfg.proxyEnabled === true) {
      return (cfg.proxy || '').trim();   // 供应商专属代理
    }
    if (cfg.proxyEnabled === false) {
      return '';  // 明确直连，忽略全局代理
    }
  }
  // 未配置（旧数据或从未设置） → 回退全局代理
  return (appSettings.proxy || '').trim();
}

/**
 * 为指定供应商获取 undici ProxyAgent dispatcher。
 * @param {string} providerId
 * @returns {ProxyAgent|undefined}
 */
function getProxyDispatcherForProvider(providerId) {
  const proxyUrl = getProxyForProvider(providerId);
  if (!proxyUrl || !ProxyAgent) return undefined;
  try {
    return new ProxyAgent(normaliseProxyUrl(proxyUrl));
  } catch (e) {
    console.error('[proxy] Failed to create ProxyAgent:', e.message);
    return undefined;
  }
}
```

**修改点：**
- 创建 OpenAI/Anthropic 客户端时，将 `getProxyDispatcher()` 替换为 `getProxyDispatcherForProvider(aiSettings.providerId)`。
- GitHub Copilot 请求使用 `getProxyDispatcherForProvider('copilot')`。
- Windows PowerShell fallback 路径也改用 `getProxyForProvider(aiSettings.providerId)`。
- 原 `getProxyDispatcher()` 函数可保留以兼容任何其他使用点，或直接删除。

---

## UI 设计

### 布局（两个组件相同）

在每个供应商配置区域内，紧接现有字段（API 密钥、Base URL 等）之后、保存按钮之前，添加代理配置区块：

```
┌─ 网络代理 ─────────────────────────────────────┐
│  [toggle] 为此供应商启用代理                     │
│  代理地址: [http://127.0.0.1:7890_____________] │  ← 仅开关打开时显示
│  支持 http:// 和 socks5:// 协议                │
└───────────────────────────────────────────────┘
```

### 交互规则

- **开关默认状态：** 若 `proxyEnabled` 为 `undefined`（未配置），UI 显示为关闭。
- **开关打开：** 显示代理地址输入框，允许填写。
- **开关关闭：** 隐藏输入框；保存时将 `proxyEnabled: false` 写入配置（明确直连语义）。
- **清除配置：** 若用户想回退到全局代理，需要删除该供应商的配置（或通过"重置"操作将 `proxyEnabled` 置为 `undefined`）。此场景在当前需求范围内无需额外 UI。

### State 管理

在已有的 per-provider 本地状态（`editingProvider` 或等效变量）中追加：

```typescript
proxy: string;          // 代理地址输入框的值
proxyEnabled: boolean;  // 开关状态
```

保存时随其他字段一同提交到 `/api/ai-settings`。

---

## 受影响文件

| 文件 | 改动类型 |
|---|---|
| `src/types.ts` | 扩展 `ProviderConfig` 接口（+2 字段） |
| `server/index.js` | 新增 `getProxyForProvider`、`getProxyDispatcherForProvider`；更新调用点 |
| `src/components/SettingsPage.tsx` | 供应商配置区域添加代理 toggle + 输入框 |
| `src/components/SettingsDialog.tsx` | 同上 |

---

## 边界情况

- **旧配置兼容：** `proxyEnabled` 字段缺失时服务端回退全局代理，不影响现有用户。
- **空代理地址：** 开关打开但地址为空时，等同于无代理（空字符串直连）。
- **proxyEnabled = false 且有 proxy 地址：** 以 `proxyEnabled` 为准，直连（地址仅作历史记录保留）。
- **GitHub Copilot OAuth 流程：** Copilot 的 token 刷新请求也走 `getProxyForProvider('copilot')`，确保一致性。
