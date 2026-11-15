import type { TranslationKey } from './i18n';

/**
 * Gezaaide kennisbank-sheetnamen (DB-waarden blijven Nederlands — matching en
 * data blijven ongemoeid). Dit is puur een weergave-vertaling: bekende
 * seed-namen worden in de gekozen taal getoond, alle andere (zelfgemaakte)
 * tags vallen terug op de ruwe naam.
 */
const SEED_TAG_NAME_KEYS: Record<string, TranslationKey> = {
  technieken: 'kennis.tagNames.technieken',
  kooktijden: 'kennis.tagNames.kooktijden',
  "ratio's": 'kennis.tagNames.ratios',
  temperaturen: 'kennis.tagNames.temperaturen',
  substituties: 'kennis.tagNames.substituties',
};

export function isSeedKnowledgeTagName(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(SEED_TAG_NAME_KEYS, name.trim().toLowerCase());
}

/** Weergavenaam voor een kennisbank-tag/sheet in de actieve taal. */
export function translateKnowledgeTagName(
  name: string,
  t: (key: TranslationKey) => string
): string {
  const key = SEED_TAG_NAME_KEYS[name.trim().toLowerCase()];
  return key ? t(key) : name;
}
