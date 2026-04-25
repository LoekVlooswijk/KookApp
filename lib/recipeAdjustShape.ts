import type { FullRecipe } from './types';

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
