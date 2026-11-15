import { getAppMeta, setAppMeta } from './appMeta';
import { ensureDatabaseAsync } from './db';
import type { LanguageId } from './i18n';

const META_LANGUAGE = 'pref_language';

/**
 * UI-taal. `null` betekent: nog nooit gekozen (eerste start) —
 * dan toont de app de taalkeuze-overlay. Nieuwe key in de `pref_*`-reeks.
 */
export function parseLanguageId(raw: string | null): LanguageId | null {
  if (raw === 'nl' || raw === 'en') {
    return raw;
  }
  return null;
}

export async function getLanguageId(): Promise<LanguageId | null> {
  await ensureDatabaseAsync();
  return parseLanguageId(await getAppMeta(META_LANGUAGE));
}

export async function persistLanguageId(id: LanguageId): Promise<void> {
  await ensureDatabaseAsync();
  await setAppMeta(META_LANGUAGE, id);
}
