import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  loadAppearanceFromDb,
  persistAccentPresetId,
  persistBackgroundToneId,
  resolveAppTheme,
  type AccentPresetId,
  type AppTheme,
  type BackgroundToneId,
} from '../lib/appearancePrefs';

export type AppThemeContextValue = AppTheme & {
  accentId: AccentPresetId;
  backgroundId: BackgroundToneId;
  themeReady: boolean;
  setAccentPreset: (id: AccentPresetId) => Promise<void>;
  setBackgroundTone: (id: BackgroundToneId) => Promise<void>;
  /** Leest thema opnieuw uit de database (bijv. na restore van een backup). */
  reloadThemeFromDatabase: () => Promise<void>;
};

const defaultTheme = resolveAppTheme('terracotta', 'warm');

const ThemeContext = createContext<AppThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [accentId, setAccentId] = useState<AccentPresetId>('terracotta');
  const [backgroundId, setBackgroundId] = useState<BackgroundToneId>('warm');
  const [themeReady, setThemeReady] = useState(false);

  const applyLoaded = useCallback((accent: AccentPresetId, background: BackgroundToneId) => {
    setAccentId(accent);
    setBackgroundId(background);
  }, []);

  useEffect(() => {
    void loadAppearanceFromDb()
      .then(({ accent, background }) => {
        applyLoaded(accent, background);
      })
      .catch(() => {
        /* defaults */
      })
      .finally(() => {
        setThemeReady(true);
      });
  }, [applyLoaded]);

  const reloadThemeFromDatabase = useCallback(async () => {
    const { accent, background } = await loadAppearanceFromDb();
    applyLoaded(accent, background);
  }, [applyLoaded]);

  const palette = useMemo(() => resolveAppTheme(accentId, backgroundId), [accentId, backgroundId]);

  const value = useMemo((): AppThemeContextValue => {
    return {
      ...palette,
      accentId,
      backgroundId,
      themeReady,
      setAccentPreset: async (id: AccentPresetId) => {
        await persistAccentPresetId(id);
        setAccentId(id);
      },
      setBackgroundTone: async (id: BackgroundToneId) => {
        await persistBackgroundToneId(id);
        setBackgroundId(id);
      },
      reloadThemeFromDatabase,
    };
  }, [palette, accentId, backgroundId, themeReady, reloadThemeFromDatabase]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useAppTheme(): AppThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    return {
      ...defaultTheme,
      accentId: 'terracotta',
      backgroundId: 'warm',
      themeReady: false,
      setAccentPreset: async () => {},
      setBackgroundTone: async () => {},
      reloadThemeFromDatabase: async () => {},
    };
  }
  return ctx;
}
