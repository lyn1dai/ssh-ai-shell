# XCloud/XSpark Provider Integration Design

**Date:** 2026-05-03  
**Status:** Approved  
**Scope:** Add Lenovo XCloud (XSpark) as a new AI provider supporting both OpenAI-compatible and Anthropic-compatible API formats.

---

## Background

Lenovo XCloud (XSpark) exposes two API endpoints at the same base URL:

- `POST /xspark/api/v1/chat/completions` — OpenAI-compatible format
- `POST /xspark/api/v1/messages` — Anthropic-compatible format

Both use Bearer token authentication. The existing codebase already has both `openai` and `@anthropic-ai/sdk` installed.

---

## Goal

Add XCloud as a named preset provider in the settings page, allowing users to:
1. Enter their API key
2. Choose which API format to use (OpenAI or Anthropic)
3. Auto-discover available models

---

## Architecture

The integration follows the existing provider pattern (Approach B): a single named provider entry with a new `apiFormat` field that routes server-side API calls to the appropriate SDK.

No new abstraction layers are introduced. Changes are confined to:
- `src/types.ts` — type definitions
- `src/components/SettingsPage.tsx` — UI and provider registry
- `server/index.js` — client factory and chat endpoint

---

## Data Structures

### `src/types.ts`

Add to `AIProvider` interface:
```ts
apiFormats?: Array<'openai' | 'anthropic'>
```

Add to `AISettings` interface:
```ts
apiFormat?: 'openai' | 'anthropic'  // default: 'openai'
```

### Provider Registry (`src/components/SettingsPage.tsx`)

New entry in `AI_PROVIDERS`:
```ts
{
  id: 'xcloud',
  name: 'Lenovo XCloud (XSpark)',
  baseUrl: 'https://xcloud.lenovo.com/xspark/api/v1',
  models: [],
  apiFormats: ['openai', 'anthropic'],
}
```

### Persistence (`data/ai-settings.json`)

`apiFormat` is saved alongside existing fields (`providerId`, `baseUrl`, `apiKey`, `model`). Default value: `'openai'`.

---

## Frontend UI

When a provider with `apiFormats` is selected, a format selector appears below the API Key field:

```
供应商:   [Lenovo XCloud (XSpark)    ▼]
Base URL:  https://xcloud.lenovo.com/xspark/api/v1  (read-only)
API Key:   [••••••••••••••••••••••••]

API 格式:  ● OpenAI 兼容
           ○ Anthropic 兼容
```

- Default: `openai`
- Selector only renders when `provider.apiFormats` is non-empty
- State is saved on the existing "Save" action (no new save button)

---

## Backend Logic

### `server/index.js` — `aiSettings` default

```js
let aiSettings = readJSON('ai-settings.json', {
  providerId: 'custom',
  baseUrl: '', apiKey: '', model: '', configured: false,
  terminalModel: '', enabledModels: [],
  apiFormat: 'openai',  // new
});
```

### Client Factory (`createAIClientAsync`)

```js
if (aiSettings.apiFormat === 'anthropic') {
  return new Anthropic({
    apiKey: aiSettings.apiKey,
    baseURL: aiSettings.baseUrl,
  });
}
// existing OpenAI SDK path (unchanged)
```

### Chat Endpoint (`POST /api/ai/chat`)

Branch on `apiFormat`:

**Anthropic format:**
- Extract `system` messages → pass as top-level `system` parameter
- Convert remaining messages: `content` string → `[{type: 'text', text: '...'}]`
- Call `client.messages.create({ model, max_tokens, system, messages, stream: true })`
- Handle Anthropic SSE stream events: `content_block_delta` → extract `delta.text`
- Emit same `data: {"text": "..."}` SSE format to frontend (no frontend changes needed)

**OpenAI format:**
- Existing logic unchanged

### Model Discovery (`POST /api/test-ai-connection`)

XCloud's OpenAI-format endpoint supports `GET /models`. Existing discovery logic is reused without modification.

**Model discovery always uses OpenAI SDK regardless of `apiFormat`**, because both API formats share the same base URL and `GET /models` is an OpenAI-compatible endpoint on XCloud. The `test-ai-connection` handler must construct a temporary OpenAI client (using `aiSettings.baseUrl` and `aiSettings.apiKey`) rather than calling `createAIClientAsync()` when `apiFormat === 'anthropic'`.

### Settings Save (`PUT /api/ai-settings`)

Pass through `apiFormat` field — no special handling needed beyond existing key-value persistence.

---

## Error Handling

- If Anthropic SDK throws on bad credentials → propagate as existing error response (same pattern as OpenAI)
- If `apiFormat` is missing or invalid → default to `'openai'`
- Streaming errors for Anthropic format → caught by existing try/catch around the SSE loop, client receives error message

---

## Testing

Manual verification steps:
1. Select XCloud provider, enter API key, select OpenAI format → send a message → confirm response
2. Select XCloud provider, same key, select Anthropic format → send a message → confirm response
3. Test model auto-discovery (OpenAI format) → confirm model list populates
4. Verify settings persist across page reload
5. Verify switching between XCloud and another provider works without residual `apiFormat` affecting other providers

---

## Out of Scope

- No changes to the Copilot OAuth flow
- No changes to the SFTP, terminal, or MCP subsystems
- No new unit tests (project has no existing test framework)
- Anthropic format model discovery (relies on manual entry or `/models` if XCloud supports it)
