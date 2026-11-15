import { draftPayloadToFullRecipe, fullRecipeToExtractShape } from '../recipeAdjustShape';
import {
  applyRecipeFromChat,
  buildApplyCreateFromChatSystemPrompt,
  buildCreateChatSystemPrompt,
  stripDraftOnlyFields,
} from '../recipeCreate';
import type { RecipeSavePayload } from '../types';

function samplePayload(): RecipeSavePayload {
  return {
    title: 'Pasta citroen',
    description: 'Snelle pasta',
    sourceUrl: 'https://example.com',
    baseServings: 2,
    prepTimeMin: 10,
    cookTimeMin: 15,
    totalTimeMin: 25,
    category: 'pasta',
    dietVegetarian: true,
    dietVegan: false,
    dietKeto: false,
    isFavorite: false,
    wantToTry: true,
    bioScoreColor: null,
    bioScoreUpdatedAt: null,
    bioScoreItems: null,
    notes: 'lekker met peper',
    imageUri: 'file:///foto.jpg',
    tagNames: ['italiaans', 'snel'],
    ingredientGroups: [
      {
        title: '',
        ingredients: [
          { name: 'pasta', amount: 200, unit: 'g' },
          { name: '', amount: null, unit: null },
        ],
      },
    ],
    stepSections: [
      {
        title: '',
        steps: [
          { description: 'Kook de pasta.', timerSeconds: 600 },
          { description: '', timerSeconds: null },
        ],
      },
    ],
  };
}

describe('draftPayloadToFullRecipe', () => {
  it('mapt een draft naar een synthetisch FullRecipe (id 0) en filtert lege regels', () => {
    const r = draftPayloadToFullRecipe(samplePayload());
    expect(r.id).toBe(0);
    expect(r.title).toBe('Pasta citroen');
    expect(r.sourceUrl).toBe('https://example.com');
    expect(r.notes).toBe('lekker met peper');
    expect(r.imageUri).toBe('file:///foto.jpg');
    expect(r.tags).toEqual(['italiaans', 'snel']);
    expect(r.ingredientGroups).toHaveLength(1);
    expect(r.ingredientGroups[0]?.ingredients).toHaveLength(1);
    expect(r.ingredientGroups[0]?.ingredients[0]).toMatchObject({
      name: 'pasta',
      amount: 200,
      unit: 'g',
      groupId: 1,
    });
    expect(r.stepSections[0]?.steps).toHaveLength(1);
    expect(r.stepSections[0]?.steps[0]).toMatchObject({
      description: 'Kook de pasta.',
      timerSeconds: 600,
    });
  });

  it('zet lege strings om naar null', () => {
    const r = draftPayloadToFullRecipe({
      ...samplePayload(),
      description: '   ',
      category: '',
      sourceUrl: ' ',
      notes: '',
      imageUri: '',
    });
    expect(r.description).toBeNull();
    expect(r.category).toBeNull();
    expect(r.sourceUrl).toBeNull();
    expect(r.notes).toBeNull();
    expect(r.imageUri).toBeNull();
  });

  it('round-trip naar extract-shape behoudt titel, ingrediënten, stappen en tags', () => {
    const shape = fullRecipeToExtractShape(draftPayloadToFullRecipe(samplePayload())) as Record<
      string,
      unknown
    >;
    expect(shape.title).toBe('Pasta citroen');
    const groups = shape.ingredient_groups as {
      ingredients: { name: string; amount: number | null }[];
    }[];
    expect(groups[0]?.ingredients[0]?.name).toBe('pasta');
    expect(groups[0]?.ingredients[0]?.amount).toBe(200);
    const sections = shape.step_sections as {
      steps: { description: string; timer_seconds: number | null }[];
    }[];
    expect(sections[0]?.steps[0]?.timer_seconds).toBe(600);
    expect(shape.tags).toEqual(['italiaans', 'snel']);
  });
});

describe('create-chat prompts', () => {
  it('buildCreateChatSystemPrompt is Nederlands engericht op een nieuw recept', () => {
    const p = buildCreateChatSystemPrompt();
    expect(p).toContain('NIEUW recept');
    expect(p).toContain('Nederlands');
  });

  it('buildApplyCreateFromChatSystemPrompt bevat het JSON-schema en JSON-only regel', () => {
    const p = buildApplyCreateFromChatSystemPrompt();
    expect(p).toContain('ingredient_groups');
    expect(p).toContain('step_sections');
    expect(p).toContain('alleen de JSON');
  });
});

describe('stripDraftOnlyFields', () => {
  it('wist bron, foto, notities, status en bio-score maar behoudt receptvelden', () => {
    const out = stripDraftOnlyFields(samplePayload());
    expect(out.sourceUrl).toBe('');
    expect(out.imageUri).toBe('');
    expect(out.notes).toBe('');
    expect(out.isFavorite).toBe(false);
    expect(out.wantToTry).toBe(false);
    expect(out.bioScoreColor).toBeNull();
    expect(out.bioScoreUpdatedAt).toBeNull();
    expect(out.bioScoreItems).toBeNull();
    expect(out.title).toBe('Pasta citroen');
    expect(out.ingredientGroups[0]?.ingredients[0]?.name).toBe('pasta');
  });
});

describe('applyRecipeFromChat', () => {
  it('weigert een lege chat zonder AI-call', async () => {
    const res = await applyRecipeFromChat([]);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.message).toBe('Geen bespreking om toe te passen.');
    }
  });
});
