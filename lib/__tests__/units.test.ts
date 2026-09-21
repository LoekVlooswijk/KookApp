import { canonicalIngredientUnit, isNonScalableUnit, normalizeUnitToken } from '../units';

describe('units', () => {
  it('normalizeUnitToken lowercases and trims', () => {
    expect(normalizeUnitToken('  EL  ')).toBe('el');
  });

  it('canonicalIngredientUnit maps synonyms', () => {
    expect(canonicalIngredientUnit('gram')).toBe('g');
    expect(canonicalIngredientUnit('milliliter')).toBe('ml');
  });

  it('isNonScalableUnit detects snuf / naar smaak', () => {
    expect(isNonScalableUnit('snuf')).toBe(true);
    expect(isNonScalableUnit('naar smaak')).toBe(true);
    expect(isNonScalableUnit('g')).toBe(false);
  });
});
