import { normalizeRecipeSavePayload, countSqlPlaceholders } from '../recipeSavePayload';
import { parseExtractedRecipeJson } from '../recipeExtract';

describe('normalizeRecipeSavePayload', () => {
  it('fills missing bio-score fields with null defaults', () => {
    const payload = normalizeRecipeSavePayload({
      title: 'Test',
      ingredientGroups: [{ title: '', ingredients: [{ name: 'water', amount: null, unit: null }] }],
      stepSections: [{ title: '', steps: [{ description: 'Koken', timerSeconds: null }] }],
    });
    expect(payload.bioScoreColor).toBeNull();
    expect(payload.bioScoreUpdatedAt).toBeNull();
    expect(payload.bioScoreItems).toBeNull();
  });

  it('coerces invalid bio_score_color to null', () => {
    const payload = normalizeRecipeSavePayload({
      title: 'Test',
      bioScoreColor: 'purple' as never,
      ingredientGroups: [{ title: '', ingredients: [{ name: 'water', amount: null, unit: null }] }],
      stepSections: [{ title: '', steps: [{ description: 'Koken', timerSeconds: null }] }],
    });
    expect(payload.bioScoreColor).toBeNull();
  });
});

describe('parseExtractedRecipeJson + save payload', () => {
  it('accepts AI JSON without bio fields', () => {
    const model = JSON.stringify({
      title: 'Soep',
      ingredient_groups: [{ ingredients: [{ name: 'water' }] }],
      step_sections: [{ steps: [{ description: 'Koken.' }] }],
    });
    const res = parseExtractedRecipeJson(model, 'https://example.com');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.payload.bioScoreColor).toBeNull();
      expect(res.payload.bioScoreUpdatedAt).toBeNull();
      expect(res.payload.bioScoreItems).toBeNull();
    }
  });
});

describe('recipes INSERT SQL', () => {
  const insertSql = `INSERT INTO recipes (title, description, source_url, base_servings, prep_time_min, cook_time_min, total_time_min,
        category, diet_vegetarian, diet_vegan, diet_keto, is_favorite, want_to_try, bio_score_color, bio_score_updated_at, bio_score_items_json, notes, image_uri, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  it('matches column count to placeholder count', () => {
    const columns = insertSql.match(/\(([^)]+)\)/)?.[1] ?? '';
    const columnCount = columns
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean).length;
    expect(countSqlPlaceholders(insertSql)).toBe(columnCount);
    expect(columnCount).toBe(20);
  });
});
