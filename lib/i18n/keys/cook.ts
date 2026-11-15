/**
 * Kookmodus-domein (nl + en samen, zodat beide talen bij een wijziging
 * naast elkaar liggen). Gebruikt door `lib/i18n/nl.ts` en `lib/i18n/en.ts`.
 */
import type { Widen } from './widen';

export const cookNl = {
  screen: {
    title: 'Kookmodus',
    invalidRecipe: 'Ongeldig recept.',
  },
  view: {
    notFound: 'Recept niet gevonden.',
    recipePhoto: 'Receptfoto',
    ingredientsTitle: 'Ingrediënten',
    stepsTitle: 'Stappen',
    startTimer: 'Start timer ({duration})',
    pauseTimer: 'Pauzeer timer',
    resumeTimer: 'Hervat timer',
    resetTimer: 'Reset timer',
  },
  scaler: {
    title: 'Porties',
    subOne: 'Recept is voor {base} persoon. Pas aan wat je nu kookt.',
    subMany: 'Recept is voor {base} personen. Pas aan wat je nu kookt.',
    suffix: 'personen',
    compactSuffix: 'pers.',
  },
  scaledList: {
    heading: 'Ingrediënten',
    hintOne: 'Geschaald voor {target} persoon (×{factor})',
    hintMany: 'Geschaald voor {target} personen (×{factor})',
  },
  chat: {
    fab: 'Tips & vraag',
    title: 'Kookhulp',
    voiceInputLabel: 'Stem invoer (later beschikbaar)',
    voiceHint: 'Stem: later (Whisper)',
    close: 'Sluiten',
    noKey: 'Zet een API-sleutel in Instellingen om tips te kunnen vragen.',
    toSettings: 'Naar instellingen',
    introOne: 'Stel een korte vraag over dit recept (je kookt voor {servings} persoon).',
    introMany: 'Stel een korte vraag over dit recept (je kookt voor {servings} personen).',
    roleYou: 'Jij',
    roleChef: 'Kok',
    thinking: 'Even geduld…',
    adjusting: 'Recept aanpassen…',
    errorHint: 'Verstuur je vraag nogmaals of probeer het later.',
    adjust: 'Recept aanpassen',
    adjustedTitle: 'Recept aangepast',
    adjustedMessage: 'De wijziging is opgeslagen. De vorige versie staat in de versiegeschiedenis.',
    saveFailed: 'Opslaan mislukt.',
    inputPlaceholder: 'Je vraag…',
    send: 'Verstuur',
    tips: {
      prepAhead: 'Kan ik dit een dag van tevoren voorbereiden?',
      substitute: 'Wat kan ik gebruiken als ik een ingrediënt mis?',
      doneness: 'Hoe weet ik of het goed gaar is?',
    },
  },
} as const;

export const cookEn: Widen<typeof cookNl> = {
  screen: {
    title: 'Cooking mode',
    invalidRecipe: 'Invalid recipe.',
  },
  view: {
    notFound: 'Recipe not found.',
    recipePhoto: 'Recipe photo',
    ingredientsTitle: 'Ingredients',
    stepsTitle: 'Steps',
    startTimer: 'Start timer ({duration})',
    pauseTimer: 'Pause timer',
    resumeTimer: 'Resume timer',
    resetTimer: 'Reset timer',
  },
  scaler: {
    title: 'Servings',
    subOne: 'This recipe serves {base} person. Adjust it to what you are cooking now.',
    subMany: 'This recipe serves {base} people. Adjust it to what you are cooking now.',
    suffix: 'servings',
    compactSuffix: 'serv.',
  },
  scaledList: {
    heading: 'Ingredients',
    hintOne: 'Scaled for {target} person (×{factor})',
    hintMany: 'Scaled for {target} people (×{factor})',
  },
  chat: {
    fab: 'Tips & questions',
    title: 'Cooking help',
    voiceInputLabel: 'Voice input (coming later)',
    voiceHint: 'Voice: later (Whisper)',
    close: 'Close',
    noKey: 'Set an API key in Settings to ask for tips.',
    toSettings: 'Go to settings',
    introOne: 'Ask a short question about this recipe (you are cooking for {servings} person).',
    introMany: 'Ask a short question about this recipe (you are cooking for {servings} people).',
    roleYou: 'You',
    roleChef: 'Chef',
    thinking: 'One moment…',
    adjusting: 'Updating recipe…',
    errorHint: 'Send your question again or try again later.',
    adjust: 'Update recipe',
    adjustedTitle: 'Recipe updated',
    adjustedMessage: 'The change has been saved. The previous version is in the version history.',
    saveFailed: 'Failed to save.',
    inputPlaceholder: 'Your question…',
    send: 'Send',
    tips: {
      prepAhead: 'Can I prepare this a day in advance?',
      substitute: 'What can I use if I am missing an ingredient?',
      doneness: 'How do I know when it is properly cooked?',
    },
  },
} as const;
