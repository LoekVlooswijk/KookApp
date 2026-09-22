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
    enabled: true,
    supportsWebSearch: false,
    supportsVision: true,
  },
  mistral: {
    id: 'mistral',
    label: 'Mistral',
    enabled: true,
    supportsWebSearch: false,
    supportsVision: true,
    // Note: Vision models can be added to AI_MODEL_PRESETS.mistral when available.
  },
} as const;

export function listAiProviders(): AiProviderInfo[] {
  return (Object.keys(AI_PROVIDERS) as AiProviderId[]).map((id) => AI_PROVIDERS[id]);
}

export type AiModelPreset = { key: string; label: string; modelId: string };

/**
 * Model presets: `modelId` is de **vaste snapshot** in de app (reproduceerbaar tot de volgende update).
 * Met “altijd nieuwste alias” in instellingen wordt waar mogelijk de provider-alias gebruikt
 * (zie `MODEL_PINNED_TO_LATEST_ALIAS`), bijv. Haiku-snapshot → `claude-haiku-4-5`.
 */
export const AI_MODEL_PRESETS: Record<AiProviderId, AiModelPreset[]> = {
  anthropic: [
    {
      key: 'haiku',
      label: 'Haiku',
      modelId: 'claude-haiku-4-5-20251001',
    },
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

/** Snapshot model-id → provider-alias die Anthropic naar de actuele release laat wijzen. */
export const MODEL_PINNED_TO_LATEST_ALIAS: Partial<Record<AiProviderId, Record<string, string>>> = {
  anthropic: {
    'claude-haiku-4-5-20251001': 'claude-haiku-4-5',
  },
};

export function resolvePresetModelId(provider: AiProviderId, presetKey: string): string | null {
  const presets = AI_MODEL_PRESETS[provider] ?? [];
  const hit = presets.find((p) => p.key === presetKey);
  return hit?.modelId ?? null;
}

/** Preset → API-modelstring; met `preferLatestAlias` worden bekende snapshots naar provider-aliases omgezet. */
export function resolvePresetToApiModelId(
  provider: AiProviderId,
  presetKey: string,
  preferLatestAlias: boolean
): string | null {
  const pinned = resolvePresetModelId(provider, presetKey);
  if (!pinned) return null;
  if (!preferLatestAlias) return pinned;
  return MODEL_PINNED_TO_LATEST_ALIAS[provider]?.[pinned] ?? pinned;
}
