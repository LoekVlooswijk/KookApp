import { deleteAppMeta, getAppMeta, setAppMeta } from './appMeta';
import type { AiProviderId } from './aiProviders';
import { resolvePresetModelId } from './aiProviders';

const META_ACTIVE_KEY_ID = 'ai_active_key_id';
const META_MODEL_PRESET_PREFIX = 'ai_model_preset_';
const META_MODEL_CUSTOM_PREFIX = 'ai_model_custom_';

let activeKeyIdCache: string | null = null;
const modelPresetCache: Partial<Record<AiProviderId, string>> = {};
const modelCustomCache: Partial<Record<AiProviderId, string>> = {};

export async function hydrateAiPrefsFromDb(): Promise<void> {
  activeKeyIdCache = (await getAppMeta(META_ACTIVE_KEY_ID))?.trim() || null;

  const providers: AiProviderId[] = ['anthropic', 'openai', 'gemini', 'mistral'];
  for (const p of providers) {
    modelPresetCache[p] = (await getAppMeta(`${META_MODEL_PRESET_PREFIX}${p}`))?.trim() || '';
    modelCustomCache[p] = (await getAppMeta(`${META_MODEL_CUSTOM_PREFIX}${p}`))?.trim() || '';
  }
}

export function getActiveAiKeyId(): string | null {
  return activeKeyIdCache;
}

export async function setActiveAiKeyId(id: string | null): Promise<void> {
  activeKeyIdCache = id?.trim() || null;
  if (!activeKeyIdCache) {
    await deleteAppMeta(META_ACTIVE_KEY_ID);
    return;
  }
  await setAppMeta(META_ACTIVE_KEY_ID, activeKeyIdCache);
}

export function getAiModelPresetKey(provider: AiProviderId): string {
  const v = modelPresetCache[provider] ?? '';
  return v;
}

export async function setAiModelPresetKey(provider: AiProviderId, presetKey: string): Promise<void> {
  modelPresetCache[provider] = presetKey;
  await setAppMeta(`${META_MODEL_PRESET_PREFIX}${provider}`, presetKey);
}

export function getAiCustomModelId(provider: AiProviderId): string {
  return (modelCustomCache[provider] ?? '').trim();
}

export async function setAiCustomModelId(provider: AiProviderId, modelId: string): Promise<void> {
  const t = modelId.trim();
  modelCustomCache[provider] = t;
  if (!t) {
    await deleteAppMeta(`${META_MODEL_CUSTOM_PREFIX}${provider}`);
    return;
  }
  await setAppMeta(`${META_MODEL_CUSTOM_PREFIX}${provider}`, t);
}

/**
 * Resolveer de model-id voor een provider:
 * - Als custom ingevuld is: gebruik custom.
 * - Anders: preset → model-id.
 * - Anders: null.
 */
export function resolveAiModelId(provider: AiProviderId): string | null {
  const custom = getAiCustomModelId(provider);
  if (custom) return custom;
  const preset = getAiModelPresetKey(provider);
  if (!preset) return null;
  return resolvePresetModelId(provider, preset);
}
