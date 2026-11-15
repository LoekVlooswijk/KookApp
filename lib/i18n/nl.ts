/**
 * Nederlandse UI-teksten — bron van waarheid voor de key-structuur.
 * Gedeelde domains leven in `lib/i18n/keys/` (nl + en samen per domein);
 * `en.ts` is type-checked tegen deze vorm, dus ontbrekende Engelse
 * vertalingen vallen direct op in `npm run typecheck`.
 */
import { settingsNl } from './keys/settings';
import { shoppingNl } from './keys/shopping';
import { cookNl } from './keys/cook';
import { kennisNl } from './keys/kennis';
import { plannerNl } from './keys/planner';

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
  settings: settingsNl,
  shopping: shoppingNl,
  cook: cookNl,
  kennis: kennisNl,
  planner: plannerNl,
} as const;

type WidenT<T> = {
  readonly [K in keyof T]: T[K] extends string ? string : WidenT<T[K]>;
};

export type Translations = WidenT<typeof nl>;
