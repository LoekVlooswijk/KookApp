export type AiProviderId = 'anthropic' | 'openai' | 'gemini' | 'mistral';

export type AiProviderInfo = {
  id: AiProviderId;
  label: string;
  /** Of de app deze provider al kan aanroepen. */
  enabled: boolean;
  /** Ondersteunt server-side web search in onze client. */
  supportsWebSearch: boolean;
  /** Ondersteunt afbeelding + tekst prompts (vision). */
  supportsVision: boolean;
};

export const AI_PROVIDERS: Record<AiProviderId, AiProviderInfo> = {
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    enabled: true,
    supportsWebSearch: true,
    supportsVision: true,
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    enabled: true,
    supportsWebSearch: false,
    supportsVision: true,
  },
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    enabled: false,
    supportsWebSearch: false,
    supportsVision: true,
  },
  mistral: {
    id: 'mistral',
    label: 'Mistral',
    enabled: false,
    supportsWebSearch: false,
    supportsVision: false,
  },
} as const;

export function listAiProviders(): AiProviderInfo[] {
  return (Object.keys(AI_PROVIDERS) as AiProviderId[]).map((id) => AI_PROVIDERS[id]);
}

export type AiModelPreset = { key: string; label: string; modelId: string };

/** Model presets per provider. Gebruiker kan ook een custom model-id instellen. */
export const AI_MODEL_PRESETS: Record<AiProviderId, AiModelPreset[]> = {
  anthropic: [
    { key: 'haiku', label: 'Haiku', modelId: 'claude-haiku-4-5' },
    { key: 'sonnet', label: 'Sonnet', modelId: 'claude-sonnet-4-6' },
  ],
  openai: [
    { key: 'gpt4oMini', label: 'GPT‑4o mini', modelId: 'gpt-4o-mini' },
    { key: 'gpt41Mini', label: 'GPT‑4.1 mini', modelId: 'gpt-4.1-mini' },
  ],
  gemini: [
    { key: 'geminiFlash', label: 'Gemini 2.5 Flash', modelId: 'gemini-2.5-flash' },
    { key: 'geminiPro', label: 'Gemini 2.5 Pro', modelId: 'gemini-2.5-pro' },
  ],
  mistral: [
    { key: 'mistralSmall', label: 'Mistral Small', modelId: 'mistral-small-latest' },
    { key: 'mistralMedium', label: 'Mistral Medium', modelId: 'mistral-medium-latest' },
  ],
};

export function resolvePresetModelId(provider: AiProviderId, presetKey: string): string | null {
  const presets = AI_MODEL_PRESETS[provider] ?? [];
  const hit = presets.find((p) => p.key === presetKey);
  return hit?.modelId ?? null;
}
