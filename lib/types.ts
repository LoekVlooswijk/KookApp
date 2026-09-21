/** Domain types — aligned with kookapp_plan_v2.html */

export type RecipeId = number;

export type IngredientRow = {
  id: number;
  recipeId: number;
  groupId: number | null;
  name: string;
  amount: number | null;
  unit: string | null;
  orderIndex: number;
};

export type IngredientGroupRow = {
  id: number;
  recipeId: number;
  title: string | null;
  orderIndex: number;
  ingredients: IngredientRow[];
};

export type StepRow = {
  id: number;
  recipeId: number;
  sectionId: number | null;
  orderIndex: number;
  description: string;
  timerSeconds: number | null;
};

export type StepSectionRow = {
  id: number;
  recipeId: number;
  title: string | null;
  orderIndex: number;
  steps: StepRow[];
};

export type FullRecipe = {
  id: number;
  title: string;
  description: string | null;
  sourceUrl: string | null;
  baseServings: number | null;
  prepTimeMin: number | null;
  cookTimeMin: number | null;
  totalTimeMin: number | null;
  category: string | null;
  /** Dieetlabels als booleans (filterbaar, onafhankelijk van tags). */
  dietVegetarian: boolean;
  dietVegan: boolean;
  dietKeto: boolean;
  isFavorite: boolean;
  wantToTry: boolean;
  bioScoreColor: 'red' | 'orange' | 'green' | null;
  /** ISO timestamp of last bio-score compute (nullable). */
  bioScoreUpdatedAt: string | null;
  /**
   * Compact breakdown of assessed produce-only ingredients (nullable).
   * Stored as a JSON string in SQLite; parsed into an array here.
   */
  bioScoreItems: Array<{ n: string; l: 'G' | 'O' | 'R'; p: 'L' | 'M' | 'H' }> | null;
  notes: string | null;
  imageUri: string | null;
  createdAt: string;
  updatedAt: string;
  ingredientGroups: IngredientGroupRow[];
  stepSections: StepSectionRow[];
  tags: string[];
};

export type RecipeListItem = {
  id: number;
  title: string;
  category: string | null;
  updatedAt: string;
  isFavorite: boolean;
  wantToTry: boolean;
  bioScoreColor: 'red' | 'orange' | 'green' | null;
  /** Lokale file-URI of externe URL; null als geen omslag. */
  imageUri: string | null;
};

export type RecipeIngredientInput = {
  name: string;
  amount: number | null;
  unit: string | null;
};

export type RecipeIngredientGroupInput = {
  title: string;
  ingredients: RecipeIngredientInput[];
};

export type RecipeStepInput = {
  description: string;
  timerSeconds: number | null;
};

export type RecipeStepSectionInput = {
  title: string;
  steps: RecipeStepInput[];
};

/** Payload for create / update (nested structure without DB ids). */
export type RecipeSavePayload = {
  title: string;
  description: string;
  sourceUrl: string;
  baseServings: number;
  prepTimeMin: number | null;
  cookTimeMin: number | null;
  totalTimeMin: number | null;
  category: string;
  dietVegetarian: boolean;
  dietVegan: boolean;
  dietKeto: boolean;
  isFavorite: boolean;
  wantToTry: boolean;
  bioScoreColor: 'red' | 'orange' | 'green' | null;
  bioScoreUpdatedAt: string | null;
  bioScoreItems: Array<{ n: string; l: 'G' | 'O' | 'R'; p: 'L' | 'M' | 'H' }> | null;
  notes: string;
  imageUri: string;
  tagNames: string[];
  ingredientGroups: RecipeIngredientGroupInput[];
  stepSections: RecipeStepSectionInput[];
};
