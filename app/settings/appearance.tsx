import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { useAppTheme } from '../../components/ThemeContext';
import { useI18n } from '../../components/I18nContext';
import { type TranslationKey } from '../../lib/i18n';
import {
  listAccentPresetIds,
  resolveAppTheme,
  type AccentPresetId,
  type BackgroundToneId,
} from '../../lib/appearancePrefs';
import { ensureDatabaseAsync } from '../../lib/db';
import {
  getStartTabId,
  persistStartTabId,
  START_TAB_ORDER,
  type StartTabId,
} from '../../lib/startTabPrefs';

const ACCENT_LABEL_KEYS: Record<AccentPresetId, TranslationKey> = {
  terracotta: 'settings.appearancePage.accents.terracotta',
  sage: 'settings.appearancePage.accents.sage',
  ocean: 'settings.appearancePage.accents.ocean',
  plum: 'settings.appearancePage.accents.plum',
  amber: 'settings.appearancePage.accents.amber',
};

const BACKGROUND_LABEL_KEYS: Record<BackgroundToneId, TranslationKey> = {
  warm: 'settings.appearancePage.backgrounds.warm',
  cool: 'settings.appearancePage.backgrounds.cool',
  paper: 'settings.appearancePage.backgrounds.paper',
};

const START_TAB_LABEL_KEYS: Record<StartTabId, TranslationKey> = {
  recipes: 'settings.appearancePage.startTabs.recipes',
  planner: 'settings.appearancePage.startTabs.planner',
  shopping: 'settings.appearancePage.startTabs.shopping',
  kennis: 'settings.appearancePage.startTabs.kennis',
  settings: 'settings.appearancePage.startTabs.settings',
};

export default function AppearanceSettingsScreen() {
  const theme = useAppTheme();
  const { t } = useI18n();
  const { width: windowWidth } = useWindowDimensions();
  const [startTabId, setStartTabId] = useState<StartTabId>('shopping');

  const chipOnStyle = { backgroundColor: theme.accentSoft, borderColor: theme.accent };
  const chipTextOnStyle = { color: theme.accentSoftText };

  const accentIds = listAccentPresetIds();
  const accentGap = 8;
  const contentPad = 16; // matches styles.content padding
  const accentColWidth = Math.max(
    44,
    Math.floor(
      (windowWidth - contentPad * 2 - accentGap * Math.max(0, accentIds.length - 1)) /
        accentIds.length
    )
  );
  const swatchSize = Math.max(28, Math.min(36, Math.round(accentColWidth * 0.62)));
  const accentLabelFontSize = Math.max(8, Math.min(11, Math.round(accentColWidth / 6.5)));

  const reloadPrefs = useCallback(() => {
    void (async () => {
      await ensureDatabaseAsync();
      await theme.reloadThemeFromDatabase();
      setStartTabId(await getStartTabId());
    })();
  }, [theme]);

  useFocusEffect(
    useCallback(() => {
      reloadPrefs();
    }, [reloadPrefs])
  );

  return (
    <ScrollView
      style={[styles.scroll, { backgroundColor: theme.background }]}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.section}>{t('settings.appearancePage.title')}</Text>
      <Text style={styles.hint}>{t('settings.appearancePage.hint')}</Text>

      <Text style={styles.subLabel}>{t('settings.appearancePage.accentLabel')}</Text>
      <View style={styles.accentRow}>
        {accentIds.map((id) => {
          const sw = resolveAppTheme(id, 'warm');
          const selected = theme.accentId === id;
          return (
            <Pressable
              key={id}
              accessibilityRole="button"
              accessibilityLabel={t(ACCENT_LABEL_KEYS[id])}
              onPress={() => {
                void theme.setAccentPreset(id);
              }}
              style={[styles.accentCol, { width: accentColWidth }]}
            >
              <View
                style={[
                  styles.accentSwatch,
                  {
                    backgroundColor: sw.accent,
                    width: swatchSize,
                    height: swatchSize,
                    borderRadius: Math.round(swatchSize / 2),
                  },
                  selected ? styles.accentSwatchSelected : null,
                ]}
              />
              <Text
                style={[
                  styles.accentMiniLabel,
                  { fontSize: accentLabelFontSize },
                  selected ? styles.accentMiniLabelOn : null,
                ]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {t(ACCENT_LABEL_KEYS[id])}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.subLabel}>{t('settings.appearancePage.backgroundLabel')}</Text>
      <View style={styles.chipRow}>
        {(['warm', 'cool', 'paper'] as const).map((id) => (
          <Pressable
            key={id}
            style={[styles.chip, theme.backgroundId === id ? chipOnStyle : null]}
            onPress={() => {
              void theme.setBackgroundTone(id);
            }}
          >
            <Text style={[styles.chipText, theme.backgroundId === id ? chipTextOnStyle : null]}>
              {t(BACKGROUND_LABEL_KEYS[id])}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={[styles.subLabel, styles.startPageLabel]}>
        {t('settings.appearancePage.startPageLabel')}
      </Text>
      <Text style={styles.hintSmall}>{t('settings.appearancePage.startPageHint')}</Text>
      <View style={[styles.chipRow, styles.startTabChipRow]}>
        {START_TAB_ORDER.map((id) => (
          <Pressable
            key={id}
            style={[styles.chip, startTabId === id ? chipOnStyle : null]}
            onPress={() => {
              void (async () => {
                await ensureDatabaseAsync();
                await persistStartTabId(id);
                setStartTabId(id);
              })();
            }}
          >
            <Text style={[styles.chipText, startTabId === id ? chipTextOnStyle : null]}>
              {t(START_TAB_LABEL_KEYS[id])}
            </Text>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  section: { fontSize: 17, fontWeight: '700', color: '#1a1a1a', marginTop: 20, marginBottom: 8 },
  hint: { fontSize: 13, color: '#666', lineHeight: 19, marginBottom: 10 },
  hintSmall: { fontSize: 12, color: '#666', lineHeight: 18, marginBottom: 8 },
  subLabel: { fontSize: 13, fontWeight: '600', color: '#444', marginBottom: 6, marginTop: 4 },
  startPageLabel: { marginTop: 18 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  startTabChipRow: { marginBottom: 4 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#e2ddd5',
    backgroundColor: '#fff',
  },
  chipText: { fontSize: 14, color: '#444', fontWeight: '600' },
  accentRow: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    gap: 8,
    marginBottom: 8,
    justifyContent: 'space-between',
  },
  accentCol: { alignItems: 'center' },
  accentSwatch: {
    borderWidth: 2,
    borderColor: 'rgba(0,0,0,0.08)',
  },
  accentSwatchSelected: {
    borderColor: '#1a1a1a',
    transform: [{ scale: 1.06 }],
  },
  accentMiniLabel: {
    marginTop: 4,
    fontWeight: '600',
    color: '#666',
    textAlign: 'center',
    lineHeight: 12,
  },
  accentMiniLabelOn: { color: '#1a1a1a' },
});
