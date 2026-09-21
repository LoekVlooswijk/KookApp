import { deleteAppMeta, getAppMeta, setAppMeta } from './appMeta';
import type { AiProviderId } from './aiProviders';
import { resolvePresetToApiModelId } from './aiProviders';

const META_ACTIVE_KEY_ID = 'ai_active_key_id';
const META_MODEL_PRESET_PREFIX = 'ai_model_preset_';
const META_MODEL_CUSTOM_PREFIX = 'ai_model_custom_';
/** '1' / unset = gebruik provider-alias waar bekend; '0' = alleen snapshot-id uit presets. */
const META_PREFER_LATEST_ALIAS = 'ai_model_prefer_latest_alias';

/** Per-functie modelkeuze (keys in app_meta: ai_model_<task>_preset_<provider>). */
export const AI_MODEL_TASKS = ['import', 'adjust', 'weekplan'] as const;
export type AiModelTask = (typeof AI_MODEL_TASKS)[number];

let activeKeyIdCache: string | null = null;
const modelPresetCache: Partial<Record<AiProviderId, string>> = {};
const modelCustomCache: Partial<Record<AiProviderId, string>> = {};
let preferLatestAliasCache = true;

const taskPresetCache: Record<AiModelTask, Partial<Record<AiProviderId, string>>> = {
  import: {},
  adjust: {},
  weekplan: {},
};
const taskCustomCache: Record<AiModelTask, Partial<Record<AiProviderId, string>>> = {
  import: {},
  adjust: {},
  weekplan: {},
};

function metaTaskPresetKey(task: AiModelTask, provider: AiProviderId): string {
  return `ai_model_${task}_preset_${provider}`;
}

function metaTaskCustomKey(task: AiModelTask, provider: AiProviderId): string {
  return `ai_model_${task}_custom_${provider}`;
}

export async function hydrateAiPrefsFromDb(): Promise<void> {
  activeKeyIdCache = (await getAppMeta(META_ACTIVE_KEY_ID))?.trim() || null;

  const pl = (await getAppMeta(META_PREFER_LATEST_ALIAS))?.trim();
  preferLatestAliasCache = pl !== '0';

  const providers: AiProviderId[] = ['anthropic', 'openai', 'gemini', 'mistral'];
  for (const p of providers) {
    modelPresetCache[p] = (await getAppMeta(`${META_MODEL_PRESET_PREFIX}${p}`))?.trim() || '';
    modelCustomCache[p] = (await getAppMeta(`${META_MODEL_CUSTOM_PREFIX}${p}`))?.trim() || '';
  }
  for (const task of AI_MODEL_TASKS) {
    for (const p of providers) {
      taskPresetCache[task][p] = (await getAppMeta(metaTaskPresetKey(task, p)))?.trim() || '';
      taskCustomCache[task][p] = (await getAppMeta(metaTaskCustomKey(task, p)))?.trim() || '';
    }
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

export async function setAiModelPresetKey(
  provider: AiProviderId,
  presetKey: string
): Promise<void> {
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

export function isAiPreferLatestModelAliasSync(): boolean {
  return preferLatestAliasCache;
}

export async function getAiPreferLatestModelAlias(): Promise<boolean> {
  return preferLatestAliasCache;
}

export async function setAiPreferLatestModelAlias(on: boolean): Promise<void> {
  preferLatestAliasCache = on;
  await setAppMeta(META_PREFER_LATEST_ALIAS, on ? '1' : '0');
}

/**
 * Resolveer de model-id voor een provider (preset + voorkeur nieuwste alias).
 * Oude `ai_model_custom_*` waarden in de database worden genegeerd.
 */
export function resolveAiModelId(provider: AiProviderId): string | null {
  const preset = getAiModelPresetKey(provider);
  if (!preset) return null;
  return resolvePresetToApiModelId(provider, preset, isAiPreferLatestModelAliasSync());
}

export function getAiModelTaskPresetKey(task: AiModelTask, provider: AiProviderId): string {
  return taskPresetCache[task][provider] ?? '';
}

export function getAiModelTaskCustomModelId(task: AiModelTask, provider: AiProviderId): string {
  return (taskCustomCache[task][provider] ?? '').trim();
}

export async function setAiModelTaskPresetKey(
  task: AiModelTask,
  provider: AiProviderId,
  presetKey: string
): Promise<void> {
  taskPresetCache[task][provider] = presetKey;
  const k = metaTaskPresetKey(task, provider);
  if (!presetKey.trim()) {
    await deleteAppMeta(k);
    return;
  }
  await setAppMeta(k, presetKey.trim());
}

export async function setAiModelTaskCustomModelId(
  task: AiModelTask,
  provider: AiProviderId,
  modelId: string
): Promise<void> {
  const t = modelId.trim();
  taskCustomCache[task][provider] = t;
  const k = metaTaskCustomKey(task, provider);
  if (!t) {
    await deleteAppMeta(k);
    return;
  }
  await setAppMeta(k, t);
}

/**
 * Model voor een specifieke AI-functie: taak-eigen preset → anders globaal model.
 * Oude taak-custom keys in de database worden genegeerd.
 */
export function resolveAiModelIdForTask(provider: AiProviderId, task: AiModelTask): string | null {
  const taskPreset = getAiModelTaskPresetKey(task, provider);
  if (taskPreset) {
    const id = resolvePresetToApiModelId(provider, taskPreset, isAiPreferLatestModelAliasSync());
    if (id) return id;
  }
  return resolveAiModelId(provider);
}
