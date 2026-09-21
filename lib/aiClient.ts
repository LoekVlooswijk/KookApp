import type { AiProviderId } from './aiProviders';
import { AI_PROVIDERS } from './aiProviders';
import { getAiApiKeyEntryById } from './aiKeyring';
import {
  getActiveAiKeyId,
  resolveAiModelId,
  resolveAiModelIdForTask,
  type AiModelTask,
} from './aiPrefs';
import { recordAnthropicRequestLog, recordAiRequestLog } from './aiRequestLog';
import { isAiRequestLogEnabledSync } from './aiRequestLogPrefs';

export type AiOk = { ok: true; text: string };
export type AiErr = {
  ok: false;
  message: string;
  status?: number;
  debugSnippet?: string;
};

export type AiChatTurn = { role: 'user' | 'assistant'; text: string };
export type AiImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

function isRecord(x: unknown): x is Record<string, unknown> {
  return x != null && typeof x === 'object' && !Array.isArray(x);
}

async function getActiveKey(): Promise<{ provider: AiProviderId; apiKey: string } | null> {
  const activeId = getActiveAiKeyId();
  if (!activeId) return null;
  const hit = await getAiApiKeyEntryById(activeId);
  if (!hit?.apiKey?.trim()) return null;
  return { provider: hit.provider, apiKey: hit.apiKey.trim() };
}

async function requireConfiguredProvider(
  task?: AiModelTask
): Promise<
  | { ok: true; provider: AiProviderId; apiKey: string; modelId: string }
  | { ok: false; error: AiErr }
> {
  const k = await getActiveKey();
  if (!k) {
    return {
      ok: false,
      error: { ok: false, message: 'Geen API-sleutel geselecteerd. Kies er één bij Instellingen.' },
    };
  }
  const info = AI_PROVIDERS[k.provider];
  if (!info?.enabled) {
    return {
      ok: false,
      error: { ok: false, message: 'Deze AI-provider is (nog) niet beschikbaar in de app.' },
    };
  }
  const modelId = task ? resolveAiModelIdForTask(k.provider, task) : resolveAiModelId(k.provider);
  if (!modelId?.trim()) {
    return {
      ok: false,
      error: { ok: false, message: 'Geen model ingesteld. Kies een model bij Instellingen.' },
    };
  }
  return { ok: true, provider: k.provider, apiKey: k.apiKey, modelId: modelId.trim() };
}

// ---------------- Anthropic ----------------

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

function concatAnthropicTextBlocks(content: unknown): string {
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
      parts.push(block.text.trim());
    }
  }
  return parts.join('\n').trim();
}

function redactAnthropicBodyForLog(body: Record<string, unknown>): {
  redacted: unknown;
  imageBlocks: number;
  imageDataChars: number;
} {
  let imageBlocks = 0;
  let imageDataChars = 0;

  const visitContent = (content: unknown): unknown => {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return content;
    return content.map((block) => {
      if (!isRecord(block)) return block;
      if (block.type === 'image' && isRecord(block.source)) {
        const src = block.source as Record<string, unknown>;
        if (src.type === 'base64' && typeof src.data === 'string') {
          imageBlocks += 1;
          imageDataChars += src.data.length;
          return {
            ...block,
            source: {
              type: 'base64',
              media_type: src.media_type,
              data: `<redacted base64 len=${src.data.length}>`,
            },
          };
        }
      }
      return block;
    });
  };

  const visitMessages = (msgs: unknown): unknown => {
    if (!Array.isArray(msgs)) return msgs;
    return msgs.map((m) => {
      if (!isRecord(m)) return m;
      const role = m.role;
      const content = m.content;
      if (typeof content === 'string') return { role, content };
      return { role, content: visitContent(content) };
    });
  };

  const out: Record<string, unknown> = { ...body };
  if (Array.isArray(out.messages)) {
    out.messages = visitMessages(out.messages);
  }
  return { redacted: out, imageBlocks, imageDataChars };
}

function approxUserTextChars(body: Record<string, unknown>): number {
  let n = 0;
  const addStr = (s: unknown) => {
    if (typeof s === 'string') n += s.length;
  };

  addStr(body.system);

  const msgs = body.messages;
  if (!Array.isArray(msgs)) return n;
  for (const m of msgs) {
    if (!isRecord(m)) continue;
    const c = m.content;
    if (typeof c === 'string') {
      n += c.length;
      continue;
    }
    if (!Array.isArray(c)) continue;
    for (const block of c) {
      if (!isRecord(block)) continue;
      if (block.type === 'text' && typeof block.text === 'string') n += block.text.length;
    }
  }
  return n;
}

async function fetchAnthropic(
  apiKey: string,
  body: Record<string, unknown>,
  debug?: { tag?: string }
): Promise<{ ok: true; raw: string } | AiErr> {
  const wireJson = JSON.stringify(body);
  const { redacted, imageBlocks, imageDataChars } = redactAnthropicBodyForLog(body);
  const redactedJson = JSON.stringify(redacted);
  const systemChars = typeof body.system === 'string' ? body.system.length : 0;
  const userTextCharsApprox = approxUserTextChars(body);
  const model = typeof body.model === 'string' ? body.model : undefined;
  const tools = body.tools;

  const t0 = Date.now();
  let res: Response;
  try {
    res = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: wireJson,
    });
  } catch {
    if (isAiRequestLogEnabledSync()) {
      recordAnthropicRequestLog({
        provider: 'anthropic',
        tag: debug?.tag,
        url: ANTHROPIC_MESSAGES_URL,
        model,
        okHttp: false,
        requestJsonChars: wireJson.length,
        requestJsonCharsRedacted: redactedJson.length,
        imageBlocks,
        imageDataChars,
        systemChars,
        userTextCharsApprox,
        tools,
        responseChars: 0,
        errorMessage: 'fetch failed (network)',
      });
    }
    return {
      ok: false,
      message: 'Geen verbinding met AI — controleer internet en probeer opnieuw.',
    };
  }

  const raw = await res.text();
  const elapsed = Date.now() - t0;

  let stopReason: string | null | undefined;
  let usage: { input_tokens?: number; output_tokens?: number } | null = null;
  if (res.ok) {
    try {
      const j = JSON.parse(raw) as {
        stop_reason?: string | null;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      stopReason = j.stop_reason ?? null;
      usage = j.usage ?? null;
    } catch {
      /* */
    }
  }

  if (isAiRequestLogEnabledSync()) {
    recordAnthropicRequestLog({
      provider: 'anthropic',
      tag: debug?.tag,
      url: ANTHROPIC_MESSAGES_URL,
      model,
      httpStatus: res.status,
      okHttp: res.ok,
      stopReason,
      usage,
      requestJsonChars: wireJson.length,
      requestJsonCharsRedacted: redactedJson.length,
      imageBlocks,
      imageDataChars,
      systemChars,
      userTextCharsApprox,
      tools,
      responseChars: raw.length,
      errorMessage: res.ok ? undefined : `HTTP ${res.status} (${elapsed}ms)`,
    });
  }

  if (!res.ok) {
    let message = `AI gaf foutcode ${res.status}.`;
    try {
      const j = JSON.parse(raw) as { error?: { message?: string } };
      if (j.error?.message) message = j.error.message;
    } catch {
      /* */
    }
    return {
      ok: false,
      message,
      status: res.status,
      debugSnippet: raw.length > 2500 ? `${raw.slice(0, 2500)}…` : raw,
    };
  }
  return { ok: true, raw };
}

function parseAnthropicText(raw: string): AiOk | AiErr {
  let json: { content?: unknown[] };
  try {
    json = JSON.parse(raw) as { content?: unknown[] };
  } catch {
    return {
      ok: false,
      message: 'Ongeldig JSON-antwoord van AI.',
      debugSnippet: raw.slice(0, 2500),
    };
  }
  const text = concatAnthropicTextBlocks(json.content);
  if (!text.trim())
    return { ok: false, message: 'Leeg tekstantwoord van AI.', debugSnippet: raw.slice(0, 2500) };
  return { ok: true, text };
}

async function callAnthropicText(params: {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<AiOk | AiErr> {
  const fr = await fetchAnthropic(
    params.apiKey,
    {
      model: params.model,
      max_tokens: params.maxTokens ?? 8192,
      system: params.system,
      messages: [{ role: 'user', content: params.user }],
    },
    { tag: 'anthropic:text' }
  );
  if (!fr.ok) return fr;
  return parseAnthropicText(fr.raw);
}

async function callAnthropicChat(params: {
  apiKey: string;
  model: string;
  system: string;
  messages: AiChatTurn[];
  maxTokens?: number;
}): Promise<AiOk | AiErr> {
  if (params.messages.length === 0) {
    return { ok: false, message: 'Geen berichten om te versturen.' };
  }
  if (params.messages[0].role !== 'user') {
    return { ok: false, message: 'Ongeldige chat: begin met een gebruikersbericht.' };
  }
  const fr = await fetchAnthropic(
    params.apiKey,
    {
      model: params.model,
      max_tokens: params.maxTokens ?? 1536,
      system: params.system,
      messages: params.messages.map((m) => ({ role: m.role, content: m.text })),
    },
    { tag: 'anthropic:chat' }
  );
  if (!fr.ok) return fr;
  return parseAnthropicText(fr.raw);
}

async function callAnthropicWithImageText(params: {
  apiKey: string;
  model: string;
  system: string;
  userText: string;
  imageBase64: string;
  imageMediaType: AiImageMediaType;
  maxTokens?: number;
}): Promise<AiOk | AiErr> {
  const fr = await fetchAnthropic(
    params.apiKey,
    {
      model: params.model,
      max_tokens: params.maxTokens ?? 4096,
      system: params.system,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: params.imageMediaType,
                data: params.imageBase64,
              },
            },
            { type: 'text', text: params.userText },
          ],
        },
      ],
    },
    { tag: 'anthropic:vision' }
  );
  if (!fr.ok) return fr;
  return parseAnthropicText(fr.raw);
}

// Web search (Anthropic tools)
// Keep this low to prevent huge tool-result transcripts (TPM spikes).
export const AI_WEB_SEARCH_MAX_USES = 3;

async function callAnthropicTextWithWebSearch(params: {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<AiOk | AiErr> {
  const toolVariants: Array<Record<string, unknown>[]> = [
    [
      {
        type: 'web_search_20260209',
        name: 'web_search',
        max_uses: AI_WEB_SEARCH_MAX_USES,
        allowed_callers: ['direct'],
      },
    ],
    [{ type: 'web_search_20250305', name: 'web_search', max_uses: AI_WEB_SEARCH_MAX_USES }],
  ];

  let lastHttpErr: AiErr | null = null;

  toolLoop: for (let ti = 0; ti < toolVariants.length; ti++) {
    const tools = toolVariants[ti];
    const messages: Array<{ role: 'user' | 'assistant'; content: string | unknown[] }> = [
      { role: 'user', content: params.user },
    ];

    // Each pause_turn can accumulate large tool results in the model-side context.
    // Keep this low to avoid huge input token usage.
    const maxPauseLoops = 3;
    for (let pi = 0; pi < maxPauseLoops; pi++) {
      const fr = await fetchAnthropic(
        params.apiKey,
        {
          model: params.model,
          max_tokens: params.maxTokens ?? 8192,
          system: params.system,
          messages,
          tools,
        },
        { tag: `anthropic:web_search t${ti} p${pi}` }
      );
      if (!fr.ok) {
        lastHttpErr = fr;
        if (fr.status === 400 && ti < toolVariants.length - 1) continue toolLoop;
        return fr;
      }

      let json: { content?: unknown[]; stop_reason?: string | null };
      try {
        json = JSON.parse(fr.raw) as { content?: unknown[]; stop_reason?: string | null };
      } catch {
        return {
          ok: false,
          message: 'Ongeldig JSON-antwoord van AI.',
          debugSnippet: fr.raw.slice(0, 2500),
        };
      }

      const stop = json.stop_reason ?? null;
      const content = Array.isArray(json.content) ? json.content : [];
      if (stop === 'pause_turn') {
        messages.push({ role: 'assistant', content });
        continue;
      }

      const text = concatAnthropicTextBlocks(content);
      if (!text.trim()) {
        return {
          ok: false,
          message: 'Leeg tekstantwoord van AI (na web search).',
          debugSnippet: fr.raw.slice(0, 2500),
        };
      }
      return { ok: true, text };
    }

    return { ok: false, message: 'Web search: te veel tussenrondes. Probeer opnieuw.' };
  }

  return lastHttpErr ?? { ok: false, message: 'Web search mislukt.' };
}

// ---------------- OpenAI ----------------

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';

// ---------------- Mistral ----------------

const MISTRAL_CHAT_URL = 'https://api.mistral.ai/v1/chat/completions';

function approxMistralTextChars(body: Record<string, unknown>): number {
  let n = 0;
  const addStr = (s: unknown) => {
    if (typeof s === 'string') n += s.length;
  };

  addStr(body.system);

  const msgs = body.messages;
  if (!Array.isArray(msgs)) return n;
  for (const m of msgs) {
    if (!isRecord(m)) continue;
    const c = m.content;
    if (typeof c === 'string') {
      n += c.length;
      continue;
    }
    if (!Array.isArray(c)) continue;
    for (const block of c) {
      if (!isRecord(block)) continue;
      if (block.type === 'text' && typeof block.text === 'string') n += block.text.length;
    }
  }
  return n;
}

async function fetchMistral(
  apiKey: string,
  body: Record<string, unknown>,
  debug?: { tag?: string }
): Promise<{ ok: true; raw: string } | AiErr> {
  const wireJson = JSON.stringify(body);
  const model = typeof body.model === 'string' ? body.model : undefined;
  const systemChars = typeof body.system === 'string' ? body.system.length : 0;
  const userTextCharsApprox = approxMistralTextChars(body);

  const t0 = Date.now();
  let res: Response;
  try {
    res = await fetch(MISTRAL_CHAT_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: wireJson,
    });
  } catch {
    if (isAiRequestLogEnabledSync()) {
      recordAiRequestLog({
        provider: 'mistral',
        tag: debug?.tag,
        url: MISTRAL_CHAT_URL,
        model,
        okHttp: false,
        requestJsonChars: wireJson.length,
        requestJsonCharsRedacted: wireJson.length,
        imageBlocks: 0,
        imageDataChars: 0,
        systemChars,
        userTextCharsApprox,
        responseChars: 0,
        errorMessage: 'fetch failed (network)',
      });
    }
    return {
      ok: false,
      message: 'Geen verbinding met AI — controleer internet en probeer opnieuw.',
    };
  }

  const raw = await res.text();
  const elapsed = Date.now() - t0;

  let stopReason: string | null | undefined;
  let usage: { input_tokens?: number; output_tokens?: number } | null = null;
  if (res.ok) {
    try {
      const j = JSON.parse(raw) as {
        stop_reason?: string | null;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      stopReason = j.stop_reason ?? null;
      usage = j.usage ?? null;
    } catch {
      /* */
    }
  }

  if (isAiRequestLogEnabledSync()) {
    recordAiRequestLog({
      provider: 'mistral',
      tag: debug?.tag,
      url: MISTRAL_CHAT_URL,
      model,
      httpStatus: res.status,
      okHttp: res.ok,
      stopReason,
      usage,
      requestJsonChars: wireJson.length,
      requestJsonCharsRedacted: wireJson.length,
      imageBlocks: 0,
      imageDataChars: 0,
      systemChars,
      userTextCharsApprox,
      responseChars: raw.length,
      errorMessage: res.ok ? undefined : `HTTP ${res.status} (${elapsed}ms)`,
    });
  }

  if (!res.ok) {
    let message = `AI gaf foutcode ${res.status}.`;
    try {
      const j = JSON.parse(raw) as { error?: { message?: string } };
      if (j.error?.message) message = j.error.message;
    } catch {
      /* */
    }
    return {
      ok: false,
      message,
      status: res.status,
      debugSnippet: raw.length > 2500 ? `${raw.slice(0, 2500)}…` : raw,
    };
  }
  return { ok: true, raw };
}

// Mistral uses OpenAI-compatible response format, so we reuse parseOpenAiText

async function callMistralText(params: {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<AiOk | AiErr> {
  const fr = await fetchMistral(params.apiKey, {
    model: params.model,
    messages: [
      { role: 'system', content: params.system },
      { role: 'user', content: params.user },
    ],
    max_tokens: params.maxTokens ?? 8192,
  });
  if (!fr.ok) return fr;
  return parseOpenAiText(fr.raw);
}

async function callMistralChat(params: {
  apiKey: string;
  model: string;
  system: string;
  messages: AiChatTurn[];
  maxTokens?: number;
}): Promise<AiOk | AiErr> {
  if (params.messages.length === 0) {
    return { ok: false, message: 'Geen berichten om te versturen.' };
  }
  if (params.messages[0].role !== 'user') {
    return { ok: false, message: 'Ongeldige chat: begin met een gebruikersbericht.' };
  }
  const fr = await fetchMistral(params.apiKey, {
    model: params.model,
    messages: [
      { role: 'system', content: params.system },
      ...params.messages.map((m) => ({ role: m.role, content: m.text })),
    ],
    max_tokens: params.maxTokens ?? 1536,
  });
  if (!fr.ok) return fr;
  return parseOpenAiText(fr.raw);
}

async function callMistralWithImageText(params: {
  apiKey: string;
  model: string;
  system: string;
  userText: string;
  imageBase64: string;
  imageMediaType: AiImageMediaType;
  maxTokens?: number;
}): Promise<AiOk | AiErr> {
  // Mistral supports OpenAI-compatible vision with base64 data URLs
  const dataUrl = `data:${params.imageMediaType};base64,${params.imageBase64}`;
  const fr = await fetchMistral(params.apiKey, {
    model: params.model,
    messages: [
      { role: 'system', content: params.system },
      {
        role: 'user',
        content: [
          { type: 'text', text: params.userText },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
    max_tokens: params.maxTokens ?? 4096,
  });
  if (!fr.ok) return fr;
  return parseOpenAiText(fr.raw);
}

// ---------------- OpenAI ----------------

function parseOpenAiText(raw: string): AiOk | AiErr {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      message: 'Ongeldig JSON-antwoord van AI.',
      debugSnippet: raw.slice(0, 2500),
    };
  }
  if (!isRecord(json)) {
    return { ok: false, message: 'Ongeldig antwoord van AI.', debugSnippet: raw.slice(0, 2500) };
  }
  const choices = Array.isArray(json.choices) ? json.choices : [];
  const first = choices[0];
  if (!isRecord(first)) {
    return { ok: false, message: 'Leeg antwoord van AI.', debugSnippet: raw.slice(0, 2500) };
  }
  const msg = isRecord(first.message) ? first.message : null;
  const content = msg && typeof msg.content === 'string' ? msg.content : '';
  const text = (content ?? '').trim();
  if (!text)
    return { ok: false, message: 'Leeg tekstantwoord van AI.', debugSnippet: raw.slice(0, 2500) };
  return { ok: true, text };
}

async function fetchOpenAi(
  apiKey: string,
  body: Record<string, unknown>
): Promise<{ ok: true; raw: string } | AiErr> {
  let res: Response;
  try {
    res = await fetch(OPENAI_CHAT_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    return {
      ok: false,
      message: 'Geen verbinding met AI — controleer internet en probeer opnieuw.',
    };
  }
  const raw = await res.text();
  if (!res.ok) {
    let message = `AI gaf foutcode ${res.status}.`;
    try {
      const j = JSON.parse(raw) as { error?: { message?: string } };
      if (j.error?.message) message = j.error.message;
    } catch {
      /* */
    }
    return {
      ok: false,
      message,
      status: res.status,
      debugSnippet: raw.length > 2500 ? `${raw.slice(0, 2500)}…` : raw,
    };
  }
  return { ok: true, raw };
}

async function callOpenAiText(params: {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<AiOk | AiErr> {
  const fr = await fetchOpenAi(params.apiKey, {
    model: params.model,
    messages: [
      { role: 'system', content: params.system },
      { role: 'user', content: params.user },
    ],
    max_tokens: params.maxTokens ?? 8192,
  });
  if (!fr.ok) return fr;
  return parseOpenAiText(fr.raw);
}

async function callOpenAiChat(params: {
  apiKey: string;
  model: string;
  system: string;
  messages: AiChatTurn[];
  maxTokens?: number;
}): Promise<AiOk | AiErr> {
  if (params.messages.length === 0) {
    return { ok: false, message: 'Geen berichten om te versturen.' };
  }
  if (params.messages[0].role !== 'user') {
    return { ok: false, message: 'Ongeldige chat: begin met een gebruikersbericht.' };
  }
  const fr = await fetchOpenAi(params.apiKey, {
    model: params.model,
    messages: [
      { role: 'system', content: params.system },
      ...params.messages.map((m) => ({ role: m.role, content: m.text })),
    ],
    max_tokens: params.maxTokens ?? 1536,
  });
  if (!fr.ok) return fr;
  return parseOpenAiText(fr.raw);
}

async function callOpenAiWithImageText(params: {
  apiKey: string;
  model: string;
  system: string;
  userText: string;
  imageBase64: string;
  imageMediaType: AiImageMediaType;
  maxTokens?: number;
}): Promise<AiOk | AiErr> {
  const dataUrl = `data:${params.imageMediaType};base64,${params.imageBase64}`;
  const fr = await fetchOpenAi(params.apiKey, {
    model: params.model,
    messages: [
      { role: 'system', content: params.system },
      {
        role: 'user',
        content: [
          { type: 'text', text: params.userText },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
    max_tokens: params.maxTokens ?? 4096,
  });
  if (!fr.ok) return fr;
  return parseOpenAiText(fr.raw);
}

// ---------------- Public generic API ----------------

export async function hasActiveAiKey(): Promise<boolean> {
  const k = await getActiveKey();
  return !!k?.apiKey?.trim();
}

export async function callAiText(params: {
  system: string;
  user: string;
  maxTokens?: number;
  /** Modelkeuze uit AI-instellingen voor deze functie (importeren / aanpassen / weekmenu). */
  task?: AiModelTask;
}): Promise<AiOk | AiErr> {
  const cfg = await requireConfiguredProvider(params.task);
  if (!cfg.ok) return cfg.error;
  if (cfg.provider === 'anthropic') {
    return callAnthropicText({ apiKey: cfg.apiKey, model: cfg.modelId, ...params });
  }
  if (cfg.provider === 'openai') {
    return callOpenAiText({ apiKey: cfg.apiKey, model: cfg.modelId, ...params });
  }
  if (cfg.provider === 'mistral') {
    return callMistralText({ apiKey: cfg.apiKey, model: cfg.modelId, ...params });
  }
  return { ok: false, message: 'Onbekende AI-provider.' };
}

export async function callAiChat(params: {
  system: string;
  messages: AiChatTurn[];
  maxTokens?: number;
  task?: AiModelTask;
}): Promise<AiOk | AiErr> {
  const cfg = await requireConfiguredProvider(params.task);
  if (!cfg.ok) return cfg.error;
  if (cfg.provider === 'anthropic') {
    return callAnthropicChat({ apiKey: cfg.apiKey, model: cfg.modelId, ...params });
  }
  if (cfg.provider === 'openai') {
    return callOpenAiChat({ apiKey: cfg.apiKey, model: cfg.modelId, ...params });
  }
  if (cfg.provider === 'mistral') {
    return callMistralChat({ apiKey: cfg.apiKey, model: cfg.modelId, ...params });
  }
  return { ok: false, message: 'Onbekende AI-provider.' };
}

export async function callAiWithImageText(params: {
  system: string;
  userText: string;
  imageBase64: string;
  imageMediaType: AiImageMediaType;
  maxTokens?: number;
  task?: AiModelTask;
}): Promise<AiOk | AiErr> {
  const cfg = await requireConfiguredProvider(params.task);
  if (!cfg.ok) return cfg.error;
  const p = AI_PROVIDERS[cfg.provider];
  if (!p.supportsVision) {
    return { ok: false, message: 'Deze AI-provider ondersteunt geen afbeeldingen.' };
  }
  if (cfg.provider === 'anthropic') {
    return callAnthropicWithImageText({ apiKey: cfg.apiKey, model: cfg.modelId, ...params });
  }
  if (cfg.provider === 'openai') {
    return callOpenAiWithImageText({ apiKey: cfg.apiKey, model: cfg.modelId, ...params });
  }
  if (cfg.provider === 'mistral') {
    return callMistralWithImageText({ apiKey: cfg.apiKey, model: cfg.modelId, ...params });
  }
  return { ok: false, message: 'Onbekende AI-provider.' };
}

export async function callAiTextWithWebSearch(params: {
  system: string;
  user: string;
  maxTokens?: number;
  task?: AiModelTask;
}): Promise<AiOk | AiErr> {
  const cfg = await requireConfiguredProvider(params.task);
  if (!cfg.ok) return cfg.error;
  const p = AI_PROVIDERS[cfg.provider];
  if (!p.supportsWebSearch) {
    return { ok: false, message: 'Web search is alleen beschikbaar voor Anthropic.' };
  }
  return callAnthropicTextWithWebSearch({ apiKey: cfg.apiKey, model: cfg.modelId, ...params });
}

export type { AiModelTask } from './aiPrefs';
