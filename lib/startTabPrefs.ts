import type { Href } from 'expo-router';

import { getAppMeta, setAppMeta } from './appMeta';
import { ensureDatabaseAsync } from './db';

const META_START_TAB = 'pref_start_tab';

/** Which tab opens when the app starts (cold launch → `/(tabs)`). */
export type StartTabId = 'recipes' | 'planner' | 'shopping' | 'kennis' | 'settings';

export const START_TAB_ORDER: readonly StartTabId[] = [
  'recipes',
  'planner',
  'shopping',
  'kennis',
  'settings',
];

export const START_TAB_LABELS: Record<StartTabId, string> = {
  recipes: 'Recepten',
  planner: 'Week',
  shopping: 'Boodschappen',
  kennis: 'Kennis',
  settings: 'Instellingen',
};

const HREF: Record<StartTabId, Href> = {
  recipes: '/(tabs)/recipes',
  planner: '/(tabs)/planner',
  shopping: '/(tabs)/shopping',
  kennis: '/(tabs)/kennis',
  settings: '/(tabs)/settings',
};

function parseStartTab(raw: string | null): StartTabId {
  if (
    raw === 'recipes' ||
    raw === 'planner' ||
    raw === 'shopping' ||
    raw === 'kennis' ||
    raw === 'settings'
  ) {
    return raw;
  }
  return 'shopping';
}

export async function getStartTabId(): Promise<StartTabId> {
  await ensureDatabaseAsync();
  const v = await getAppMeta(META_START_TAB);
  return parseStartTab(v);
}

export async function getStartTabHref(): Promise<Href> {
  const id = await getStartTabId();
  return HREF[id];
}

export async function persistStartTabId(id: StartTabId): Promise<void> {
  await ensureDatabaseAsync();
  await setAppMeta(META_START_TAB, id);
}
