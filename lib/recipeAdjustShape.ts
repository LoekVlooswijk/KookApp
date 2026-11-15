import type { FullRecipe, RecipeSavePayload } from './types';

/** Zelfde structuur als URL-extractie (structured JSON voor AI). */
export function fullRecipeToExtractShape(recipe: FullRecipe): Record<string, unknown> {
  return {
    title: recipe.title,
    description: recipe.description,
    base_servings: recipe.baseServings ?? 4,
    prep_time_min: recipe.prepTimeMin,
    cook_time_min: recipe.cookTimeMin,
    total_time_min: recipe.totalTimeMin,
    category: recipe.category,
    ingredient_groups: recipe.ingredientGroups.map((g) => ({
      title: g.title,
      ingredients: g.ingredients.map((i) => ({
        name: i.name,
        amount: i.amount,
        unit: i.unit,
      })),
    })),
    step_sections: recipe.stepSections.map((s) => ({
      title: s.title,
      steps: s.steps.map((st) => ({
        description: st.description,
        timer_seconds: st.timerSeconds,
      })),
    })),
    tags: [...recipe.tags],
  };
}

/**
 * Bouwt een synthetisch FullRecipe (id 0) uit een formulier-draft.
 * Wordt gebruikt voor de AI-aanpas-chat op de nieuw-recept pagina, waar nog geen
 * opgeslagen recept is. Lege ingredient-/stapregels worden weggelaten.
 */
export function draftPayloadToFullRecipe(p: RecipeSavePayload): FullRecipe {
  const now = new Date().toISOString();
  return {
    id: 0,
    title: p.title,
    description: p.description.trim() || null,
    sourceUrl: p.sourceUrl.trim() || null,
    baseServings: p.baseServings,
    prepTimeMin: p.prepTimeMin,
    cookTimeMin: p.cookTimeMin,
    totalTimeMin: p.totalTimeMin,
    category: p.category.trim() || null,
    dietVegetarian: p.dietVegetarian,
    dietVegan: p.dietVegan,
    dietKeto: p.dietKeto,
    isFavorite: p.isFavorite,
    wantToTry: p.wantToTry,
    bioScoreColor: p.bioScoreColor ?? null,
    bioScoreUpdatedAt: p.bioScoreUpdatedAt ?? null,
    bioScoreItems: p.bioScoreItems ?? null,
    notes: p.notes.trim() || null,
    imageUri: p.imageUri.trim() || null,
    createdAt: now,
    updatedAt: now,
    ingredientGroups: p.ingredientGroups.map((g, gi) => ({
      id: gi + 1,
      recipeId: 0,
      title: g.title.trim() || null,
      orderIndex: gi,
      ingredients: g.ingredients
        .filter((i) => i.name.trim())
        .map((i, ii) => ({
          id: gi * 1000 + ii + 1,
          recipeId: 0,
          groupId: gi + 1,
          name: i.name,
          amount: i.amount,
          unit: i.unit,
          orderIndex: ii,
        })),
    })),
    stepSections: p.stepSections.map((s, si) => ({
      id: si + 1,
      recipeId: 0,
      title: s.title.trim() || null,
      orderIndex: si,
      steps: s.steps
        .filter((st) => st.description.trim())
        .map((st, ti) => ({
          id: si * 1000 + ti + 1,
          recipeId: 0,
          sectionId: si + 1,
          orderIndex: ti,
          description: st.description,
          timerSeconds: st.timerSeconds,
        })),
    })),
    tags: [...p.tagNames],
  };
}
