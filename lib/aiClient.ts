import type { AiProviderId } from './aiProviders';
import { AI_PROVIDERS } from './aiProviders';
import { listAiApiKeys } from './aiKeyring';
import { getActiveAiKeyId, resolveAiModelId } from './aiPrefs';

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
  const all = await listAiApiKeys();
  const hit = all.find((k) => k.id === activeId);
  if (!hit?.apiKey?.trim()) return null;
  return { provider: hit.provider, apiKey: hit.apiKey.trim() };
}

async function requireConfiguredProvider(): Promise<
  | { ok: true; provider: AiProviderId; apiKey: string; modelId: string }
  | { ok: false; error: AiErr }
> {
  const k = await getActiveKey();
  if (!k) {
    return { ok: false, error: { ok: false, message: 'Geen API-sleutel geselecteerd. Kies er één bij Instellingen.' } };
  }
  const info = AI_PROVIDERS[k.provider];
  if (!info?.enabled) {
    return { ok: false, error: { ok: false, message: 'Deze AI-provider is (nog) niet beschikbaar in de app.' } };
  }
  const modelId = resolveAiModelId(k.provider);
  if (!modelId?.trim()) {
    return { ok: false, error: { ok: false, message: 'Geen model ingesteld. Kies een model bij Instellingen.' } };
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

async function fetchAnthropic(
  apiKey: string,
  body: Record<string, unknown>
): Promise<{ ok: true; raw: string } | AiErr> {
  let res: Response;
  try {
    res = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, message: 'Geen verbinding met AI — controleer internet en probeer opnieuw.' };
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

function parseAnthropicText(raw: string): AiOk | AiErr {
  let json: { content?: unknown[] };
  try {
    json = JSON.parse(raw) as { content?: unknown[] };
  } catch {
    return { ok: false, message: 'Ongeldig JSON-antwoord van AI.', debugSnippet: raw.slice(0, 2500) };
  }
  const text = concatAnthropicTextBlocks(json.content);
  if (!text.trim()) return { ok: false, message: 'Leeg tekstantwoord van AI.', debugSnippet: raw.slice(0, 2500) };
  return { ok: true, text };
}

async function callAnthropicText(params: {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<AiOk | AiErr> {
  const fr = await fetchAnthropic(params.apiKey, {
    model: params.model,
    max_tokens: params.maxTokens ?? 8192,
    system: params.system,
    messages: [{ role: 'user', content: params.user }],
  });
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
  const fr = await fetchAnthropic(params.apiKey, {
    model: params.model,
    max_tokens: params.maxTokens ?? 1536,
    system: params.system,
    messages: params.messages.map((m) => ({ role: m.role, content: m.text })),
  });
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
  const fr = await fetchAnthropic(params.apiKey, {
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
  });
  if (!fr.ok) return fr;
  return parseAnthropicText(fr.raw);
}

// Web search (Anthropic tools)
export const AI_WEB_SEARCH_MAX_USES = 25;

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

    const maxPauseLoops = 8;
    for (let pi = 0; pi < maxPauseLoops; pi++) {
      const fr = await fetchAnthropic(params.apiKey, {
        model: params.model,
        max_tokens: params.maxTokens ?? 8192,
        system: params.system,
        messages,
        tools,
      });
      if (!fr.ok) {
        lastHttpErr = fr;
        if (fr.status === 400 && ti < toolVariants.length - 1) continue toolLoop;
        return fr;
      }

      let json: { content?: unknown[]; stop_reason?: string | null };
      try {
        json = JSON.parse(fr.raw) as { content?: unknown[]; stop_reason?: string | null };
      } catch {
        return { ok: false, message: 'Ongeldig JSON-antwoord van AI.', debugSnippet: fr.raw.slice(0, 2500) };
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

function parseOpenAiText(raw: string): AiOk | AiErr {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, message: 'Ongeldig JSON-antwoord van AI.', debugSnippet: raw.slice(0, 2500) };
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
  if (!text) return { ok: false, message: 'Leeg tekstantwoord van AI.', debugSnippet: raw.slice(0, 2500) };
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
    return { ok: false, message: 'Geen verbinding met AI — controleer internet en probeer opnieuw.' };
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
}): Promise<AiOk | AiErr> {
  const cfg = await requireConfiguredProvider();
  if (!cfg.ok) return cfg.error;
  if (cfg.provider === 'anthropic') {
    return callAnthropicText({ apiKey: cfg.apiKey, model: cfg.modelId, ...params });
  }
  if (cfg.provider === 'openai') {
    return callOpenAiText({ apiKey: cfg.apiKey, model: cfg.modelId, ...params });
  }
  return { ok: false, message: 'Onbekende AI-provider.' };
}

export async function callAiChat(params: {
  system: string;
  messages: AiChatTurn[];
  maxTokens?: number;
}): Promise<AiOk | AiErr> {
  const cfg = await requireConfiguredProvider();
  if (!cfg.ok) return cfg.error;
  if (cfg.provider === 'anthropic') {
    return callAnthropicChat({ apiKey: cfg.apiKey, model: cfg.modelId, ...params });
  }
  if (cfg.provider === 'openai') {
    return callOpenAiChat({ apiKey: cfg.apiKey, model: cfg.modelId, ...params });
  }
  return { ok: false, message: 'Onbekende AI-provider.' };
}

export async function callAiWithImageText(params: {
  system: string;
  userText: string;
  imageBase64: string;
  imageMediaType: AiImageMediaType;
  maxTokens?: number;
}): Promise<AiOk | AiErr> {
  const cfg = await requireConfiguredProvider();
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
  return { ok: false, message: 'Onbekende AI-provider.' };
}

export async function callAiTextWithWebSearch(params: {
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<AiOk | AiErr> {
  const cfg = await requireConfiguredProvider();
  if (!cfg.ok) return cfg.error;
  const p = AI_PROVIDERS[cfg.provider];
  if (!p.supportsWebSearch) {
    return { ok: false, message: 'Web search is alleen beschikbaar voor Anthropic.' };
  }
  return callAnthropicTextWithWebSearch({ apiKey: cfg.apiKey, model: cfg.modelId, ...params });
}
