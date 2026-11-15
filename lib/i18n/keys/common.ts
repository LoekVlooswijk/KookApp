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
} as const;

export const commonEn: Widen<typeof commonNl> = {
  confirm: {
    ok: 'OK',
    cancel: 'Cancel',
  },
} as const;
