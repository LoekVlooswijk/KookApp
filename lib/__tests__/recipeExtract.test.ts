import {
  coerceModelJsonText,
  parseExtractedRecipeJson,
  stripCodeFence,
  stripLeadingProseBeforeJson,
} from '../recipeExtract';

describe('recipeExtract string helpers', () => {
  it('stripCodeFence removes json fences', () => {
    expect(stripCodeFence('```json\n{ "a": 1 }\n```')).toBe('{ "a": 1 }');
  });

  it('stripLeadingProseBeforeJson drops preamble before {', () => {
    expect(stripLeadingProseBeforeJson('Hier is het recept: {"title":"x"}')).toBe('{"title":"x"}');
  });

  it('coerceModelJsonText extracts first complete object', () => {
    const out = coerceModelJsonText(
      'Oké {"title":"T","ingredient_groups":[],"step_sections":[]} trailing'
    );
    expect(out).toBe('{"title":"T","ingredient_groups":[],"step_sections":[]}');
  });
});

describe('parseExtractedRecipeJson', () => {
  const minimalModel = JSON.stringify({
    title: 'Soep',
    ingredient_groups: [
      {
        ingredients: [{ name: 'water', amount: 500, unit: 'ml' }],
      },
    ],
    step_sections: [{ steps: [{ description: 'Koken.' }] }],
  });

  it('parses a minimal valid extraction payload', () => {
    const res = parseExtractedRecipeJson(minimalModel, 'https://example.com/r');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.payload.title).toBe('Soep');
      expect(res.payload.sourceUrl).toBe('https://example.com/r');
      expect(res.payload.ingredientGroups.length).toBeGreaterThan(0);
      expect(res.payload.stepSections.length).toBeGreaterThan(0);
    }
  });

  it('rejects invalid JSON', () => {
    const res = parseExtractedRecipeJson('not json', '');
    expect(res.ok).toBe(false);
  });

  it('drops tags that duplicate ingredient names', () => {
    const model = JSON.stringify({
      title: 'Salade',
      tags: ['venkel', 'lente'],
      ingredient_groups: [
        {
          ingredients: [{ name: '1 venkel', amount: 1, unit: null }],
        },
      ],
      step_sections: [{ steps: [{ description: 'Mengen.' }] }],
    });
    const res = parseExtractedRecipeJson(model, '');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.payload.tagNames).toContain('lente');
      expect(res.payload.tagNames).not.toContain('venkel');
    }
  });
});
