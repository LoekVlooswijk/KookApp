/**
 * Nederlandse UI-teksten — bron van waarheid voor de key-structuur.
 * Nieuwe keys hier toevoegen; `en.ts` is type-checked tegen deze vorm,
 * dus ontbrekende Engelse vertalingen vallen direct op in `npm run typecheck`.
 */
export const nl = {
  boot: {
    loading: 'Database laden…',
    unknownError: 'Onbekende fout.',
    failTitle: 'Database niet beschikbaar',
    failBody:
      'De app kan je lokale gegevens nu niet openen. Sluit andere vensters of probeer opnieuw.',
    retry: 'Opnieuw proberen',
  },
  tabs: {
    recipes: 'Recepten',
    week: 'Week',
    shopping: 'Boodschappen',
    kennis: 'Kennis',
    settings: 'Instellingen',
  },
  headers: {
    ai: 'AI',
    aiDebug: 'AI-debuglog',
    cookProfile: 'Kookprofiel (AI)',
    shopping: 'Boodschappen',
    bioScore: 'Bio-score',
    bioScoreOverrides: 'Productscores',
    appearance: 'Uiterlijk',
    diets: 'Dieten',
    tags: 'Tags',
    data: 'Databeheer',
  },
  settings: {
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
  },
} as const;

/** Zet letterlijke `as const`-types om naar gewone strings (gebruikt in `en.ts`). */
type Widen<T> = {
  readonly [K in keyof T]: T[K] extends string ? string : Widen<T[K]>;
};

export type Translations = Widen<typeof nl>;
