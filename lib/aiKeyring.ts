import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { AiProviderId } from './aiProviders';

export type AiApiKeyEntry = {
  id: string;
  provider: AiProviderId;
  label: string;
  apiKey: string;
  createdAt: string;
  updatedAt: string;
};

/** Legacy single-blob keyring (migrated automatically). */
const LEGACY_KEYRING = 'ai_keyring_v1';
/** Index JSON: metadata only, no secrets (v2). */
const INDEX_V2 = 'ai_keyring_index_v2';
const SECRET_PREFIX = 'ai_keyring_sec_v2_';

type KeyIndexRow = Omit<AiApiKeyEntry, 'apiKey'>;

function nowIso(): string {
  return new Date().toISOString();
}

function randomId(): string {
  return `key_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return x != null && typeof x === 'object' && !Array.isArray(x);
}

function isAiProviderId(x: unknown): x is AiProviderId {
  return x === 'anthropic' || x === 'openai' || x === 'gemini' || x === 'mistral';
}

function parseKeyringJson(raw: string): AiApiKeyEntry[] {
  let root: unknown;
  try {
    root = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(root)) return [];
  const out: AiApiKeyEntry[] = [];
  for (const row of root) {
    if (!isRecord(row)) continue;
    const id = typeof row.id === 'string' ? row.id : '';
    const provider = (
      row.provider === 'anthropic' ||
      row.provider === 'openai' ||
      row.provider === 'gemini' ||
      row.provider === 'mistral'
        ? row.provider
        : null
    ) as AiProviderId | null;
    const label = typeof row.label === 'string' ? row.label : '';
    const apiKey = typeof row.apiKey === 'string' ? row.apiKey : '';
    const createdAt = typeof row.createdAt === 'string' ? row.createdAt : nowIso();
    const updatedAt = typeof row.updatedAt === 'string' ? row.updatedAt : createdAt;
    if (!id || !provider || !apiKey.trim()) continue;
    out.push({
      id,
      provider,
      label: label.trim() || 'API-sleutel',
      apiKey: apiKey.trim(),
      createdAt,
      updatedAt,
    });
  }
  return out;
}

async function migrateLegacyToV2IfNeeded(): Promise<void> {
  if (Platform.OS === 'web') return;

  const idxRaw = await SecureStore.getItemAsync(INDEX_V2);
  if (idxRaw !== null) {
    try {
      await SecureStore.deleteItemAsync(LEGACY_KEYRING);
    } catch {
      /* legacy cleanup best-effort */
    }
    return;
  }

  const legacy = await SecureStore.getItemAsync(LEGACY_KEYRING);
  if (!legacy?.trim()) {
    await SecureStore.setItemAsync(INDEX_V2, '[]');
    return;
  }

  const entries = parseKeyringJson(legacy);
  const indexRows: KeyIndexRow[] = entries.map((e) => ({
    id: e.id,
    provider: e.provider,
    label: e.label,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  }));
  await SecureStore.setItemAsync(INDEX_V2, JSON.stringify(indexRows));
  for (const e of entries) {
    await SecureStore.setItemAsync(SECRET_PREFIX + e.id, e.apiKey);
  }
  try {
    await SecureStore.deleteItemAsync(LEGACY_KEYRING);
  } catch {
    /* */
  }
}

async function readIndexRowsOnly(): Promise<KeyIndexRow[]> {
  await migrateLegacyToV2IfNeeded();
  if (Platform.OS === 'web') return [];
  const idxRaw = await SecureStore.getItemAsync(INDEX_V2);
  if (!idxRaw?.trim()) return [];
  try {
    const parsed = JSON.parse(idxRaw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((r): r is KeyIndexRow => isRecord(r) && typeof r.id === 'string');
  } catch {
    return [];
  }
}

async function readAllEntriesFromV2(): Promise<AiApiKeyEntry[]> {
  await migrateLegacyToV2IfNeeded();
  if (Platform.OS === 'web') return [];
  const rows = await readIndexRowsOnly();
  const out: AiApiKeyEntry[] = [];
  for (const row of rows) {
    if (!row?.id || !isAiProviderId(row.provider)) continue;
    const secret = await SecureStore.getItemAsync(SECRET_PREFIX + row.id);
    if (!secret?.trim()) continue;
    out.push({
      id: row.id,
      provider: row.provider,
      label: row.label,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      apiKey: secret.trim(),
    });
  }
  return out;
}

/**
 * Load a single key entry (one secret read). Use for active API key resolution.
 */
export async function getAiApiKeyEntryById(id: string): Promise<AiApiKeyEntry | null> {
  await migrateLegacyToV2IfNeeded();
  if (Platform.OS === 'web') return null;
  const trimmed = id?.trim();
  if (!trimmed) return null;

  const rows = await readIndexRowsOnly();
  const row = rows.find((r) => r.id === trimmed);
  if (!row || !isAiProviderId(row.provider)) return null;

  const secret = await SecureStore.getItemAsync(SECRET_PREFIX + trimmed);
  if (!secret?.trim()) return null;

  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    apiKey: secret.trim(),
  };
}

export async function listAiApiKeys(): Promise<AiApiKeyEntry[]> {
  return readAllEntriesFromV2();
}

export async function setAiApiKeys(entries: AiApiKeyEntry[]): Promise<void> {
  if (Platform.OS === 'web') {
    throw new Error('API-sleutels opslaan wordt op web niet ondersteund. Gebruik iOS of Android.');
  }
  await migrateLegacyToV2IfNeeded();

  const cleaned = entries
    .filter((e) => e && e.id && e.provider && e.apiKey.trim())
    .map((e) => ({
      ...e,
      label: e.label.trim() || 'API-sleutel',
      apiKey: e.apiKey.trim(),
      updatedAt: e.updatedAt || nowIso(),
      createdAt: e.createdAt || nowIso(),
    }));

  const prevRows = await readIndexRowsOnly();
  const prevIds = new Set(prevRows.map((p) => p.id));
  const nextIds = new Set(cleaned.map((e) => e.id));
  for (const id of prevIds) {
    if (!nextIds.has(id)) {
      try {
        await SecureStore.deleteItemAsync(SECRET_PREFIX + id);
      } catch {
        /* */
      }
    }
  }

  const indexRows: KeyIndexRow[] = cleaned.map((e) => ({
    id: e.id,
    provider: e.provider,
    label: e.label,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  }));
  await SecureStore.setItemAsync(INDEX_V2, JSON.stringify(indexRows));
  for (const e of cleaned) {
    await SecureStore.setItemAsync(SECRET_PREFIX + e.id, e.apiKey);
  }
  try {
    await SecureStore.deleteItemAsync(LEGACY_KEYRING);
  } catch {
    /* */
  }
}

export async function addAiApiKey(params: {
  provider: AiProviderId;
  label: string;
  apiKey: string;
}): Promise<AiApiKeyEntry> {
  const label = params.label.trim() || 'API-sleutel';
  const apiKey = params.apiKey.trim();
  if (!apiKey) {
    throw new Error('Plak eerst een API-sleutel.');
  }
  const existing = await listAiApiKeys();
  const createdAt = nowIso();
  const entry: AiApiKeyEntry = {
    id: randomId(),
    provider: params.provider,
    label,
    apiKey,
    createdAt,
    updatedAt: createdAt,
  };
  await setAiApiKeys([entry, ...existing]);
  return entry;
}

export async function updateAiApiKey(params: {
  id: string;
  label?: string;
  apiKey?: string;
}): Promise<void> {
  const entries = await listAiApiKeys();
  const next = entries.map((e) => {
    if (e.id !== params.id) return e;
    const label = params.label != null ? params.label.trim() : e.label;
    const apiKey = params.apiKey != null ? params.apiKey.trim() : e.apiKey;
    return { ...e, label: label || 'API-sleutel', apiKey, updatedAt: nowIso() };
  });
  await setAiApiKeys(next);
}

export async function deleteAiApiKey(id: string): Promise<void> {
  const entries = await listAiApiKeys();
  const next = entries.filter((e) => e.id !== id);
  await setAiApiKeys(next);
}

export async function wipeAiKeyring(): Promise<void> {
  if (Platform.OS === 'web') return;
  const rows = await readIndexRowsOnly();
  for (const r of rows) {
    try {
      await SecureStore.deleteItemAsync(SECRET_PREFIX + r.id);
    } catch {
      /* */
    }
  }
  try {
    await SecureStore.deleteItemAsync(INDEX_V2);
  } catch {
    /* */
  }
  try {
    await SecureStore.deleteItemAsync(LEGACY_KEYRING);
  } catch {
    /* */
  }
}
