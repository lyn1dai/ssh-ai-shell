# XCloud/XSpark Provider Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Lenovo XCloud (XSpark) as a named AI provider supporting both OpenAI-compatible (`/chat/completions`) and Anthropic-compatible (`/messages`) API formats, with auto model discovery and a user-selectable format toggle in the settings UI.

**Architecture:** A single `xcloud` provider entry is added to the frontend registry. A new `apiFormat` field (`'openai' | 'anthropic'`) is stored in `AISettings` and persisted to `data/ai-settings.json`. On the server, `createAIClientAsync()` returns either an OpenAI or Anthropic SDK client based on this field, and `POST /api/ai/chat` branches on `apiFormat` to call the appropriate SDK.

**Tech Stack:** React + TypeScript (frontend), Node.js + Express (backend), `openai` SDK (already installed), `@anthropic-ai/sdk` SDK (already installed).

---

### Task 1: Update type definitions in `src/types.ts`

**Files:**
- Modify: `src/types.ts:183-191` (`AIProvider` interface)
- Modify: `src/types.ts:140-157` (`AISettings` interface)

- [ ] **Step 1: Add `apiFormats` to `AIProvider` interface**

  Open `src/types.ts`. Find the `AIProvider` interface (lines 183–191). Add the `apiFormats` field:

  ```ts
  export interface AIProvider {
    id: string;
    name: string;
    baseUrl: string;
    models: string[];
    apiKeyHint: string;
    docsUrl?: string;
    authType?: 'apikey' | 'oauth';
    apiFormats?: Array<'openai' | 'anthropic'>;
  }
  ```

- [ ] **Step 2: Add `apiFormat` to `AISettings` interface**

  In the same file, find `AISettings` (lines 140–157). Add the `apiFormat` field after `providerConfigs`:

  ```ts
  export interface AISettings {
    providerId?: string;
    baseUrl: string;
    apiKey: string;
    model: string;
    terminalModel?: string;
    enabledModels?: string[];
    configured?: boolean;
    enableCommandExplain?: boolean;
    enableAIAssistant?: boolean;
    enableAutoComplete?: boolean;
    agentExecMode?: 'ask_each' | 'auto_approve_low' | 'auto_approve_all';
    commandWhitelist?: string[];
    providerConfigs?: Record<string, ProviderConfig>;
    apiFormat?: 'openai' | 'anthropic';
  }
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add src/types.ts
  git commit -m "feat(types): add apiFormats to AIProvider and apiFormat to AISettings"
  ```

---

### Task 2: Add XCloud to the provider registry in `src/components/SettingsPage.tsx`

**Files:**
- Modify: `src/components/SettingsPage.tsx:14-43` (`AI_PROVIDERS` array)

- [ ] **Step 1: Add the XCloud entry before the `custom` entry**

  Open `src/components/SettingsPage.tsx`. Find the `AI_PROVIDERS` array. Insert the new entry on line 42, just before the `custom` entry:

  ```ts
  { id: 'xcloud', name: 'Lenovo XCloud (XSpark)', baseUrl: 'https://xcloud.lenovo.com/xspark/api/v1',
    models: [], apiKeyHint: 'Bearer ...', docsUrl: 'https://xcloud.lenovo.com',
    apiFormats: ['openai', 'anthropic'] },
  ```

  The array should end as:
  ```ts
    { id: 'xcloud', name: 'Lenovo XCloud (XSpark)', baseUrl: 'https://xcloud.lenovo.com/xspark/api/v1',
      models: [], apiKeyHint: 'Bearer ...', docsUrl: 'https://xcloud.lenovo.com',
      apiFormats: ['openai', 'anthropic'] },
    { id: 'custom', name: '自定义 / 其他', baseUrl: '', models: [], apiKeyHint: '...' },
  ];
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add src/components/SettingsPage.tsx
  git commit -m "feat(ui): add Lenovo XCloud provider entry to AI_PROVIDERS"
  ```

---

### Task 3: Add `apiFormat` state management in `src/components/SettingsPage.tsx`

**Files:**
- Modify: `src/components/SettingsPage.tsx`

This task adds the `selectedApiFormat` state, initializes it on load, resets it on provider switch, and includes it in the save payload.

- [ ] **Step 1: Add `selectedApiFormat` state variable**

  Find the block starting at line 491 (`const [selectedProvider, setSelectedProvider]...`). Add a new state line directly after it:

  ```ts
  const [selectedProvider, setSelectedProvider] = useState('custom');
  const [selectedApiFormat, setSelectedApiFormat] = useState<'openai' | 'anthropic'>('openai');
  ```

- [ ] **Step 2: Initialize `selectedApiFormat` on settings load**

  Find the `useEffect` that calls `/api/ai-settings` (around line 622). Inside the `.then(data => {` block, after the line `setSelectedProvider(providerId);`, add:

  ```ts
  setSelectedApiFormat((data.apiFormat as 'openai' | 'anthropic') || 'openai');
  ```

  The relevant section becomes:
  ```ts
  setAISettings(prev => ({ ...prev, ...data, providerId }));
  setSelectedProvider(providerId);
  setSelectedApiFormat((data.apiFormat as 'openai' | 'anthropic') || 'openai');
  setActiveProviderId(providerId);
  ```

- [ ] **Step 3: Reset `selectedApiFormat` when switching providers**

  Find the `selectProvider(p: AIProvider)` function (around line 733). Add a reset line after `setSelectedProvider(p.id);`:

  ```ts
  setSelectedProvider(p.id);
  setSelectedApiFormat('openai');
  ```

- [ ] **Step 4: Include `apiFormat` in the save payload**

  Find `handleSaveAI()` (around line 1288). Locate the `payload` object (around line 1331). Add `apiFormat` to it:

  ```ts
  const payload = {
    ...aiSettings,
    providerId: selectedProvider,
    model: effectiveTerminal,
    terminalModel: effectiveTerminal,
    enabledModels: enabledList,
    providerConfigs: updatedConfigs,
    apiFormat: selectedApiFormat,
  };
  ```

- [ ] **Step 5: Commit**

  ```bash
  git add src/components/SettingsPage.tsx
  git commit -m "feat(ui): add apiFormat state management for dual-format providers"
  ```

---

### Task 4: Add API format selector UI in `src/components/SettingsPage.tsx`

**Files:**
- Modify: `src/components/SettingsPage.tsx:2764-2777` (after the API Key input block)

- [ ] **Step 1: Add the format selector after the API Key `<div>` block**

  Find the "API Key" block ending around line 2777:
  ```tsx
          </div>
        </div>

        {/* Model management */}
  ```

  Insert the format selector between the API Key block and the Model management block:

  ```tsx
                          </div>
                        </div>

                        {/* API 格式 — only shown for providers supporting multiple formats */}
                        {currentProvider.apiFormats && currentProvider.apiFormats.length > 1 && (
                          <div>
                            <label className="block text-xs text-terminal-muted mb-1.5">API 格式</label>
                            <div className="flex gap-4">
                              {currentProvider.apiFormats.map(fmt => (
                                <label key={fmt} className="flex items-center gap-2 cursor-pointer select-none">
                                  <input
                                    type="radio"
                                    name="apiFormat"
                                    value={fmt}
                                    checked={selectedApiFormat === fmt}
                                    onChange={() => { setSelectedApiFormat(fmt); setTestResult(null); }}
                                    className="accent-terminal-blue"
                                  />
                                  <span className="text-xs text-terminal-text">
                                    {fmt === 'openai' ? 'OpenAI 兼容 (/chat/completions)' : 'Anthropic 兼容 (/messages)'}
                                  </span>
                                </label>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Model management */}
  ```

  The exact `oldString` to match is the closing tags of the API Key block followed by the Model management comment:
  ```tsx
                          </div>
                        </div>

                        {/* Model management */}
  ```

- [ ] **Step 2: Verify the UI renders correctly**

  Start the dev server (`npm run dev` or `npm start`) and navigate to Settings → AI → API配置 tab. Select "Lenovo XCloud (XSpark)" from the provider list. Confirm that:
  - The Base URL field auto-fills with `https://xcloud.lenovo.com/xspark/api/v1` (read-only is not enforced but that is acceptable)
  - The "API 格式" radio group appears with two options
  - Selecting Anthropic updates the radio UI
  - Switching to a different provider (e.g. OpenAI) hides the format selector

- [ ] **Step 3: Commit**

  ```bash
  git add src/components/SettingsPage.tsx
  git commit -m "feat(ui): add API format selector for dual-format providers (XCloud)"
  ```

---

### Task 5: Update server defaults and settings persistence in `server/index.js`

**Files:**
- Modify: `server/index.js:1` (import)
- Modify: `server/index.js:147-151` (aiSettings default)
- Modify: `server/index.js:1103` (updatable keys list)

- [ ] **Step 1: Import the Anthropic SDK at the top of `server/index.js`**

  Find line 12:
  ```js
  const { OpenAI } = require('openai');
  ```

  Add the Anthropic import directly after it:
  ```js
  const { OpenAI } = require('openai');
  const { Anthropic } = require('@anthropic-ai/sdk');
  ```

- [ ] **Step 2: Add `apiFormat` to the `aiSettings` default value**

  Find lines 147–151:
  ```js
  let aiSettings = readJSON('ai-settings.json', {
    providerId: 'custom',
    baseUrl: '', apiKey: '', model: '', configured: false,
    terminalModel: '', enabledModels: [],
  });
  ```

  Replace with:
  ```js
  let aiSettings = readJSON('ai-settings.json', {
    providerId: 'custom',
    baseUrl: '', apiKey: '', model: '', configured: false,
    terminalModel: '', enabledModels: [],
    apiFormat: 'openai',
  });
  ```

- [ ] **Step 3: Add `apiFormat` to the updatable keys list in `PUT /api/ai-settings`**

  Find line 1103:
  ```js
  const updatable = ['providerId', 'baseUrl', 'apiKey', 'model', 'terminalModel', 'enabledModels', 'enableCommandExplain', 'enableAIAssistant', 'enableAutoComplete', 'agentExecMode', 'commandWhitelist', 'providerConfigs'];
  ```

  Replace with:
  ```js
  const updatable = ['providerId', 'baseUrl', 'apiKey', 'model', 'terminalModel', 'enabledModels', 'enableCommandExplain', 'enableAIAssistant', 'enableAutoComplete', 'agentExecMode', 'commandWhitelist', 'providerConfigs', 'apiFormat'];
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add server/index.js
  git commit -m "feat(server): import Anthropic SDK, add apiFormat to settings defaults and persistence"
  ```

---

### Task 6: Update `createAIClientAsync()` to return Anthropic client when needed

**Files:**
- Modify: `server/index.js:771-787`

- [ ] **Step 1: Add the Anthropic branch to `createAIClientAsync()`**

  Find the `createAIClientAsync` function (lines 771–787):
  ```js
  async function createAIClientAsync() {
    if (getSelectedProviderId() === 'copilot') {
      if (!copilotState.githubToken) return null;
      const token = await refreshCopilotTokenIfNeeded();
      if (token) {
        return createCopilotClient(token);
      }
      return null;
    }
    if (!aiSettings.baseUrl || !aiSettings.apiKey || !aiSettings.model) return null;
    const dispatcher = getProxyDispatcher();
    return new OpenAI({
      apiKey: aiSettings.apiKey,
      baseURL: aiSettings.baseUrl,
      ...(dispatcher ? { fetch: (url, opts) => fetch(url, { ...opts, dispatcher }) } : {}),
    });
  }
  ```

  Replace with:
  ```js
  async function createAIClientAsync() {
    if (getSelectedProviderId() === 'copilot') {
      if (!copilotState.githubToken) return null;
      const token = await refreshCopilotTokenIfNeeded();
      if (token) {
        return createCopilotClient(token);
      }
      return null;
    }
    if (!aiSettings.baseUrl || !aiSettings.apiKey || !aiSettings.model) return null;
    if (aiSettings.apiFormat === 'anthropic') {
      return new Anthropic({
        apiKey: aiSettings.apiKey,
        baseURL: aiSettings.baseUrl,
      });
    }
    const dispatcher = getProxyDispatcher();
    return new OpenAI({
      apiKey: aiSettings.apiKey,
      baseURL: aiSettings.baseUrl,
      ...(dispatcher ? { fetch: (url, opts) => fetch(url, { ...opts, dispatcher }) } : {}),
    });
  }
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add server/index.js
  git commit -m "feat(server): createAIClientAsync returns Anthropic client for anthropic apiFormat"
  ```

---

### Task 7: Update `POST /api/ai/chat` to handle Anthropic format

**Files:**
- Modify: `server/index.js:1137-1177`

- [ ] **Step 1: Add a helper function `toAnthropicMessages` before the chat route**

  Find the comment `// ─── AI Chat (HTTP SSE)` at line 1135. Insert the helper function just above it:

  ```js
  /** Convert OpenAI-style messages array to Anthropic format.
   * Returns { system: string, messages: AnthropicMessage[] }
   */
  function toAnthropicMessages(messages) {
    const systemParts = messages
      .filter(m => m.role === 'system')
      .map(m => (typeof m.content === 'string' ? m.content : (m.content || []).map(c => c.text || '').join('')));
    const system = systemParts.join('\n');

    const chatMessages = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role,
        content: typeof m.content === 'string'
          ? [{ type: 'text', text: m.content }]
          : m.content,
      }));

    return { system, messages: chatMessages };
  }

  // ─── AI Chat (HTTP SSE) ───────────────────────────────────────────────────────
  ```

- [ ] **Step 2: Add Anthropic streaming branch inside `POST /api/ai/chat`**

  Find the entire `try` block inside `app.post('/api/ai/chat', ...)` (lines 1154–1176):

  ```js
    try {
      const stream = await createChatCompletionWithFallback(client, {
        model: activeModel,
        max_tokens: 4096,
        messages: [{ role: 'system', content: sysMsg }, ...messages],
        stream: true,
      });

      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content;
        if (text) {
          res.write(`data: ${JSON.stringify({ text })}\n\n`);
        }
        const finishReason = chunk.choices[0]?.finish_reason;
        if (finishReason) {
          res.write(`data: ${JSON.stringify({ done: true, finishReason })}\n\n`);
        }
      }
    } catch (err) {
      res.write(`data: ${JSON.stringify({ error: err.message || '请求失败' })}\n\n`);
    } finally {
      res.end();
    }
  ```

  Replace with:

  ```js
    try {
      if (aiSettings.apiFormat === 'anthropic') {
        // ── Anthropic messages API ──────────────────────────────────────────
        const allMessages = [{ role: 'system', content: sysMsg }, ...messages];
        const { system, messages: anthropicMessages } = toAnthropicMessages(allMessages);

        const stream = await client.messages.create({
          model: activeModel,
          max_tokens: 4096,
          system: system || undefined,
          messages: anthropicMessages,
          stream: true,
        });

        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`);
          }
          if (event.type === 'message_delta' && event.delta?.stop_reason) {
            res.write(`data: ${JSON.stringify({ done: true, finishReason: event.delta.stop_reason })}\n\n`);
          }
        }
      } else {
        // ── OpenAI chat completions API (default) ───────────────────────────
        const stream = await createChatCompletionWithFallback(client, {
          model: activeModel,
          max_tokens: 4096,
          messages: [{ role: 'system', content: sysMsg }, ...messages],
          stream: true,
        });

        for await (const chunk of stream) {
          const text = chunk.choices[0]?.delta?.content;
          if (text) {
            res.write(`data: ${JSON.stringify({ text })}\n\n`);
          }
          const finishReason = chunk.choices[0]?.finish_reason;
          if (finishReason) {
            res.write(`data: ${JSON.stringify({ done: true, finishReason })}\n\n`);
          }
        }
      }
    } catch (err) {
      res.write(`data: ${JSON.stringify({ error: err.message || '请求失败' })}\n\n`);
    } finally {
      res.end();
    }
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add server/index.js
  git commit -m "feat(server): add Anthropic message format branch to POST /api/ai/chat"
  ```

---

### Task 8: Manual end-to-end verification

**Files:** None (verification only)

- [ ] **Step 1: Start the server**

  ```bash
  npm start
  ```

  Expected: Server starts on port 3000 with no import errors.

- [ ] **Step 2: Test OpenAI format**

  In the app, open Settings → AI → API配置 tab:
  1. Select "Lenovo XCloud (XSpark)"
  2. Confirm Base URL shows `https://xcloud.lenovo.com/xspark/api/v1`
  3. Enter API key `3678bb95e7954609bf86e7562cdb1da3`
  4. Confirm "API 格式" radio shows "OpenAI 兼容" selected by default
  5. Click "从 API 获取" — confirm model list loads (or manually add `DeepSeek-V4-Flash`)
  6. Star a model as terminal model
  7. Click "测试连接" — confirm success
  8. Click "保存"
  9. Open AI chat panel, send "Hello" — confirm response streams correctly

- [ ] **Step 3: Test Anthropic format**

  In Settings → AI → API配置 tab (still on XCloud):
  1. Select "Anthropic 兼容 (/messages)" radio button
  2. Click "测试连接" — confirm success (uses OpenAI `/models` endpoint for discovery, which is format-independent)
  3. Click "保存"
  4. Open AI chat panel, send "你好" — confirm response streams correctly

- [ ] **Step 4: Verify settings persist across reload**

  1. Reload the page
  2. Open Settings → AI → API配置
  3. Confirm XCloud is still selected and "Anthropic 兼容" radio is still checked

- [ ] **Step 5: Verify no regression on other providers**

  1. Switch to OpenAI provider
  2. Confirm the "API 格式" selector is NOT visible
  3. Switch to DeepSeek — same: no format selector
  4. Switch back to XCloud — format selector reappears

- [ ] **Step 6: Final commit tag**

  ```bash
  git tag v-xcloud-integration
  ```
