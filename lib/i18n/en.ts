import type { Translations } from './nl';
import { settingsEn } from './keys/settings';
import { shoppingEn } from './keys/shopping';
import { cookEn } from './keys/cook';
import { kennisEn } from './keys/kennis';
import { plannerEn } from './keys/planner';
import { commonEn } from './keys/common';
import { recipesEn } from './keys/recipes';

/** English UI texts — must stay in sync with `nl.ts` (enforced bij typecheck). */
export const en: Translations = {
  boot: {
    loading: 'Loading database…',
    unknownError: 'Unknown error.',
    failTitle: 'Database unavailable',
    failBody: 'The app cannot open your local data right now. Close other windows or try again.',
    retry: 'Try again',
  },
  tabs: {
    recipes: 'Recipes',
    week: 'Week',
    shopping: 'Shopping',
    kennis: 'Knowledge',
    settings: 'Settings',
  },
  headers: {
    ai: 'AI',
    aiDebug: 'AI debug log',
    cookProfile: 'Cook profile (AI)',
    shopping: 'Shopping',
    bioScore: 'Bio score',
    bioScoreOverrides: 'Product scores',
    appearance: 'Appearance',
    diets: 'Diets',
    tags: 'Tags',
    data: 'Data',
  },
  settings: settingsEn,
  shopping: shoppingEn,
  cook: cookEn,
  kennis: kennisEn,
  planner: plannerEn,
  common: commonEn,
  recipes: recipesEn,
};
