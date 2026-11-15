import { translate, type TranslationKey } from '../i18n';
import { isSeedKnowledgeTagName, translateKnowledgeTagName } from '../knowledgeTagNames';

function tNl(key: TranslationKey): string {
  return translate('nl', key);
}

function tEn(key: TranslationKey): string {
  return translate('en', key);
}

describe('knowledgeTagNames', () => {
  it('translates known seed sheet names per language', () => {
    expect(translateKnowledgeTagName('Temperaturen', tNl)).toBe('Temperaturen');
    expect(translateKnowledgeTagName('Temperaturen', tEn)).toBe('Temperatures');
    expect(translateKnowledgeTagName('Kooktijden', tEn)).toBe('Cooking times');
    expect(translateKnowledgeTagName('Technieken', tEn)).toBe('Techniques');
    expect(translateKnowledgeTagName("Ratio's", tEn)).toBe("Ratio's");
  });

  it('is case- and space-tolerant for seed names', () => {
    expect(translateKnowledgeTagName('  temperaturen ', tEn)).toBe('Temperatures');
    expect(isSeedKnowledgeTagName('Substituties')).toBe(true);
  });

  it('falls back to the raw name for user-created tags', () => {
    expect(translateKnowledgeTagName('Eigen notas', tEn)).toBe('Eigen notas');
    expect(isSeedKnowledgeTagName('Eigen notas')).toBe(false);
  });
});
