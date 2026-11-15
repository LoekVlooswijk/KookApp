import type { LanguageId } from './i18n';
import { getLanguageId } from './languagePrefs';

/**
 * De AI volgt de app-taal: dezelfde taal-id's als de UI (`pref_language`).
 * Default Nederlands zolang er nog geen taal is gekozen.
 */
export type AiLanguage = LanguageId;

export async function getAiLanguage(): Promise<AiLanguage> {
  return (await getLanguageId()) ?? 'nl';
}
