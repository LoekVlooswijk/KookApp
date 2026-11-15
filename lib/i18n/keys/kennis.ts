/**
 * Kennisbank-domein (nl + en samen, zodat beide talen bij een wijziging
 * naast elkaar liggen). Gebruikt door `lib/i18n/nl.ts` en `lib/i18n/en.ts`.
 */
import type { Widen } from './widen';

export const kennisNl = {
  common: {
    cancel: 'Annuleer',
    cancelA11y: 'Annuleren',
    save: 'Opslaan',
    delete: 'Verwijderen',
    edit: 'Bewerken',
    back: 'Terug',
    loading: 'Laden…',
    pin: 'Pinnen',
    unpin: 'Losmaken',
    addEntry: 'Nieuwe kennis toevoegen',
    cardOne: 'kaart',
    cardMany: 'kaarten',
    resultOne: 'resultaat',
    resultMany: 'resultaten',
    recipe: 'Recept',
  },
  home: {
    searchPlaceholder: 'Zoek in kennisbank...',
    searchClear: 'Zoekopdracht wissen',
    searchEmpty: 'Geen resultaten voor "{query}"',
    notesSection: 'NOTITIES',
    notesLooseCount: '{count} losse',
  },
  entry: {
    newTitle: 'Nieuwe entry',
    form: {
      titleLabel: 'Titel *',
      titlePlaceholder: "Bijv. Mexicaans — taco's",
      titlePlaceholderEdit: 'Titel',
      ratioLabel: 'Ratio (optioneel)',
      ratioPlaceholder: 'Bijv. 3:1 olie:zuur',
      contentLabel: 'Inhoud',
      contentPlaceholder: 'Schrijf je kennis hier…',
      tagsLabel: 'Tags',
      tagAddPlaceholder: 'Voeg tag toe…',
      sourceRecipeLabel: 'Geleerd bij (optioneel)',
      recipeSearchPlaceholder: 'Zoek recept… (meerdere woorden: spatie of komma)',
      removeRecipeA11y: 'Recept verwijderen',
    },
    detail: {
      deleteTitle: 'Kennis verwijderen?',
      deleteMessage: 'Deze kennis-entry wordt verwijderd.',
      ratioLabel: 'Ratio',
      openTagA11y: 'Open tag {name}',
      learnedAt: 'Geleerd bij',
      openRecipeA11y: 'Open recept',
    },
  },
} as const;

export const kennisEn: Widen<typeof kennisNl> = {
  common: {
    cancel: 'Cancel',
    cancelA11y: 'Cancel',
    save: 'Save',
    delete: 'Delete',
    edit: 'Edit',
    back: 'Back',
    loading: 'Loading…',
    pin: 'Pin',
    unpin: 'Unpin',
    addEntry: 'Add new knowledge',
    cardOne: 'card',
    cardMany: 'cards',
    resultOne: 'result',
    resultMany: 'results',
    recipe: 'Recipe',
  },
  home: {
    searchPlaceholder: 'Search the knowledge bank...',
    searchClear: 'Clear search',
    searchEmpty: 'No results for "{query}"',
    notesSection: 'NOTES',
    notesLooseCount: '{count} loose',
  },
  entry: {
    newTitle: 'New entry',
    form: {
      titleLabel: 'Title *',
      titlePlaceholder: 'e.g. Mexican — tacos',
      titlePlaceholderEdit: 'Title',
      ratioLabel: 'Ratio (optional)',
      ratioPlaceholder: 'e.g. 3:1 oil:acid',
      contentLabel: 'Content',
      contentPlaceholder: 'Write your knowledge here…',
      tagsLabel: 'Tags',
      tagAddPlaceholder: 'Add tag…',
      sourceRecipeLabel: 'Learned from (optional)',
      recipeSearchPlaceholder: 'Search recipes… (multiple words: space or comma)',
      removeRecipeA11y: 'Remove recipe',
    },
    detail: {
      deleteTitle: 'Delete knowledge?',
      deleteMessage: 'This knowledge entry will be deleted.',
      ratioLabel: 'Ratio',
      openTagA11y: 'Open tag {name}',
      learnedAt: 'Learned from',
      openRecipeA11y: 'Open recipe',
    },
  },
} as const;
