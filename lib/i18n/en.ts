import type { Translations } from './nl';

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
  settings: {
    languageMenuTitle: 'Language',
    sections: {
      ai: 'AI',
      app: 'App',
      recipes: 'Recipes & shopping',
      advanced: 'Advanced',
    },
    rows: {
      ai: {
        title: 'AI settings',
        subtitle: 'Manage providers, keys and model choice.',
      },
      aiDebug: {
        title: 'AI debug log',
        subtitle: 'Recent Anthropic calls (optional, kept locally in memory).',
      },
      cook: {
        title: 'Cook profile (AI)',
        subtitle: 'Allergies, dislikes and preferences for AI answers.',
      },
      appearance: {
        title: 'Appearance',
        subtitle: 'Accent colour and background.',
      },
      shopping: {
        title: 'Shopping',
        subtitle: 'What is already at home + what should always be organic.',
      },
      bioScore: {
        title: 'Bio score',
        subtitle: 'Thresholds, exclusions, fixed product scores and bulk calculation.',
      },
      beheren: {
        title: 'Manage',
        subtitle: 'Categories, tags, diets and cleanup actions.',
      },
      data: {
        title: 'Data',
        subtitle: 'Backup, import, cleanup and erase everything.',
        subtitleWeb: 'View only on web.',
      },
    },
    footer: 'Kookapp v{version}',
  },
};
