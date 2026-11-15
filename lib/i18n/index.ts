import { en } from './en';
import { nl, type Translations } from './nl';

export type LanguageId = 'nl' | 'en';

/** Zelfnamen per taal — moeten niet per actieve taal meeveranderen. */
export const LANGUAGES: readonly { id: LanguageId; label: string; hint: string }[] = [
  { id: 'nl', label: 'Nederlands', hint: 'Dutch' },
  { id: 'en', label: 'English', hint: 'Engels' },
];

type Join<K, P> = K extends string ? (P extends string ? `${K}.${P}` : never) : never;
type LeafPaths<T> = {
  [K in keyof T]: T[K] extends string ? K : Join<K, LeafPaths<T[K]>>;
}[keyof T];

/** Geldige key voor `translate`, b.v. `'settings.rows.ai.title'`. */
export type TranslationKey = LeafPaths<Translations>;

function flatten(dict: Record<string, unknown>, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(dict)) {
    if (typeof value === 'string') {
      out[prefix ? `${prefix}.${key}` : key] = value;
    } else if (value != null && typeof value === 'object') {
      Object.assign(
        out,
        flatten(value as Record<string, unknown>, prefix ? `${prefix}.${key}` : key)
      );
    }
  }
  return out;
}

const FLAT: Record<LanguageId, Record<string, string>> = {
  nl: flatten(nl),
  en: flatten(en),
};

export function flattenTranslations(lang: LanguageId): Record<string, string> {
  return FLAT[lang];
}

/** Vult `{var}`-placeholders in, b.v. `'Kookapp v{version}'` met `{ version }`. */
export function formatMessage(template: string, vars?: Record<string, string | number>): string {
  if (vars == null) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match
  );
}

/** Onbekende key valt terug op de key zelf (zichtbaar, geen crash). */
export function translate(
  lang: LanguageId,
  key: TranslationKey,
  vars?: Record<string, string | number>
): string {
  const value = FLAT[lang][key];
  return formatMessage(value ?? key, vars);
}
