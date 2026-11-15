import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { type LanguageId, translate, type TranslationKey } from '../lib/i18n';
import { getLanguageId, persistLanguageId } from '../lib/languagePrefs';

export type I18nContextValue = {
  /** Actieve taal; `null` zolang er nog geen taal gekozen is (eerste start). */
  languageId: LanguageId | null;
  languageReady: boolean;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
  setLanguage: (id: LanguageId) => Promise<void>;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [languageId, setLanguageId] = useState<LanguageId | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getLanguageId()
      .then((id) => {
        if (!cancelled) {
          setLanguageId(id);
        }
      })
      .catch(() => {
        /* default: nog niet gekozen */
      })
      .finally(() => {
        if (!cancelled) {
          setReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setLanguage = useCallback(async (id: LanguageId) => {
    setLanguageId(id);
    await persistLanguageId(id);
  }, []);

  const t = useCallback(
    (key: TranslationKey, vars?: Record<string, string | number>) =>
      translate(languageId ?? 'nl', key, vars),
    [languageId]
  );

  const value = useMemo<I18nContextValue>(
    () => ({ languageId, languageReady: ready, t, setLanguage }),
    [languageId, ready, t, setLanguage]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useI18n wordt buiten I18nProvider gebruikt');
  }
  return ctx;
}
