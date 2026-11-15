/**
 * Instellingen-domein (nl + en samen, zodat beide talen bij een wijziging
 * naast elkaar liggen). Gebruikt door `lib/i18n/nl.ts` en `lib/i18n/en.ts`.
 */
import type { Widen } from './widen';

export const settingsNl = {
  languageMenuTitle: 'Taal',
  sections: {
    ai: 'AI',
    app: 'App',
    recipes: 'Recepten & boodschappen',
    advanced: 'Geavanceerd',
  },
  rows: {
    ai: {
      title: 'AI-instellingen',
      subtitle: 'Beheer providers, sleutels en modelkeuze.',
    },
    aiDebug: {
      title: 'AI-debuglog',
      subtitle: 'Recente Anthropic-aanroepen (optioneel, lokaal in geheugen).',
    },
    cook: {
      title: 'Kookprofiel (AI)',
      subtitle: 'Allergieën, dislikes en voorkeuren voor AI-antwoorden.',
    },
    appearance: {
      title: 'Uiterlijk',
      subtitle: 'Accentkleur en achtergrond.',
    },
    shopping: {
      title: 'Boodschappen',
      subtitle: 'Wat staat al thuis + wat altijd biologisch moet.',
    },
    bioScore: {
      title: 'Bio-score',
      subtitle: 'Drempels, uitsluitingen, vaste productscores en bulk berekenen.',
    },
    beheren: {
      title: 'Beheren',
      subtitle: 'Categorieën, tags, diëten en opschoonacties.',
    },
    data: {
      title: 'Databeheer',
      subtitle: 'Backup, importeren, opschonen en alles wissen.',
      subtitleWeb: 'Op web alleen bekijken.',
    },
  },
  footer: 'Kookapp v{version}',
} as const;

export const settingsEn: Widen<typeof settingsNl> = {
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
} as const;
