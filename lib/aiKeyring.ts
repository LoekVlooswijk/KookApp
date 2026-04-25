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

const SECURE_KEYRING = 'ai_keyring_v1';

function nowIso(): string {
  return new Date().toISOString();
}

function randomId(): string {
  // Uniek genoeg voor lokale voorkeuren; geen crypto nodig.
  return `key_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return x != null && typeof x === 'object' && !Array.isArray(x);
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
    const provider = (row.provider === 'anthropic' ||
      row.provider === 'openai' ||
      row.provider === 'gemini' ||
      row.provider === 'mistral'
      ? row.provider
      : null) as AiProviderId | null;
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

async function readRawKeyring(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  try {
    return await SecureStore.getItemAsync(SECURE_KEYRING);
  } catch {
    return null;
  }
}

async function writeRawKeyring(raw: string): Promise<void> {
  if (Platform.OS === 'web') {
    throw new Error('API-sleutels opslaan wordt op web niet ondersteund. Gebruik iOS of Android.');
  }
  await SecureStore.setItemAsync(SECURE_KEYRING, raw);
}

export async function listAiApiKeys(): Promise<AiApiKeyEntry[]> {
  const raw = await readRawKeyring();
  if (!raw?.trim()) return [];
  return parseKeyringJson(raw);
}

export async function setAiApiKeys(entries: AiApiKeyEntry[]): Promise<void> {
  const cleaned = entries
    .filter((e) => e && e.id && e.provider && e.apiKey.trim())
    .map((e) => ({
      ...e,
      label: e.label.trim() || 'API-sleutel',
      apiKey: e.apiKey.trim(),
      updatedAt: e.updatedAt || nowIso(),
      createdAt: e.createdAt || nowIso(),
    }));
  await writeRawKeyring(JSON.stringify(cleaned));
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
  try {
    await SecureStore.deleteItemAsync(SECURE_KEYRING);
  } catch {
    /* already gone */
  }
}
