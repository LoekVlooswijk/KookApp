/**
 * Generieke, overgeschermde teksten (nl + en samen, zodat beide talen bij een
 * wijziging naast elkaar liggen). Gebruikt door `lib/i18n/nl.ts` en `lib/i18n/en.ts`.
 */
import type { Widen } from './widen';

export const commonNl = {
  confirm: {
    ok: 'OK',
    cancel: 'Annuleren',
  },
  timer: {
    title: 'Timer',
    finishedOne: 'Timer is afgerond.',
    finishedMany: 'Meerdere timers zijn afgerond.',
    ok: 'OK',
  },
} as const;

export const commonEn: Widen<typeof commonNl> = {
  confirm: {
    ok: 'OK',
    cancel: 'Cancel',
  },
  timer: {
    title: 'Timer',
    finishedOne: 'The timer has finished.',
    finishedMany: 'Several timers have finished.',
    ok: 'OK',
  },
};
