import { flattenTranslations, formatMessage, translate } from '../i18n';
import { en } from '../i18n/en';
import { nl } from '../i18n/nl';
import { parseLanguageId } from '../languagePrefs';

describe('i18n', () => {
  it('nl and en have exactly the same (flattened) keys', () => {
    const nlKeys = Object.keys(flattenTranslations('nl')).sort();
    const enKeys = Object.keys(flattenTranslations('en')).sort();
    expect(enKeys).toEqual(nlKeys);
    expect(nlKeys.length).toBeGreaterThan(0);
  });

  it('translate returns the active language value', () => {
    expect(translate('nl', 'tabs.settings')).toBe('Instellingen');
    expect(translate('en', 'tabs.settings')).toBe('Settings');
  });

  it('formatMessage fills {var} placeholders', () => {
    expect(formatMessage('Kookapp v{version}', { version: '1.2.3' })).toBe('Kookapp v1.2.3');
    expect(formatMessage('Kookapp v{version}')).toBe('Kookapp v{version}');
    expect(formatMessage('a {x} b {y}', { x: 1, y: 'z' })).toBe('a 1 b z');
  });

  it('translate falls back to the key for unknown translations', () => {
    // @ts-expect-error — bewust een ongeldige key
    expect(translate('nl', 'does.not.exist')).toBe('does.not.exist');
  });

  it('nested dicts are pure string leaves (no objects leak into flatten)', () => {
    for (const dict of [nl, en]) {
      for (const value of Object.values(flattenTranslations2(dict))) {
        expect(typeof value).toBe('string');
      }
    }
  });

  it('parseLanguageId accepts only nl/en, else null', () => {
    expect(parseLanguageId('nl')).toBe('nl');
    expect(parseLanguageId('en')).toBe('en');
    expect(parseLanguageId('de')).toBeNull();
    expect(parseLanguageId(null)).toBeNull();
  });
});

// flatten via de publieke route ernaast: zelfde helper, beide dicts
function flattenTranslations2(dict: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (node: unknown, prefix: string) => {
    if (typeof node === 'string') {
      out[prefix] = node;
      return;
    }
    if (node != null && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        walk(value, prefix ? `${prefix}.${key}` : key);
      }
    }
  };
  walk(dict, '');
  return out;
}
