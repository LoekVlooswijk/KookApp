import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { useAppTheme } from '../../components/ThemeContext';
import {
  ACCENT_PRESET_LABELS,
  BACKGROUND_TONE_LABELS,
  listAccentPresetIds,
  resolveAppTheme,
} from '../../lib/appearancePrefs';
import { ensureDatabaseAsync } from '../../lib/db';
import {
  getStartTabId,
  persistStartTabId,
  START_TAB_LABELS,
  START_TAB_ORDER,
  type StartTabId,
} from '../../lib/startTabPrefs';

export default function AppearanceSettingsScreen() {
  const theme = useAppTheme();
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
      <Text style={styles.section}>Uiterlijk</Text>
      <Text style={styles.hint}>
        Accentkleur voor knoppen, filters en gemarkeerde elementen. Achtergrond bepaalt de
        basiskleur van schermen en de tabbalk.
      </Text>

      <Text style={styles.subLabel}>Accentkleur</Text>
      <View style={styles.accentRow}>
        {accentIds.map((id) => {
          const sw = resolveAppTheme(id, 'warm');
          const selected = theme.accentId === id;
          return (
            <Pressable
              key={id}
              accessibilityRole="button"
              accessibilityLabel={ACCENT_PRESET_LABELS[id]}
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
                {ACCENT_PRESET_LABELS[id]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.subLabel}>Achtergrond</Text>
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
              {BACKGROUND_TONE_LABELS[id]}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={[styles.subLabel, styles.startPageLabel]}>Startpagina</Text>
      <Text style={styles.hintSmall}>
        Welk tabblad opent als je de app start (na een volledige herstart).
      </Text>
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
              {START_TAB_LABELS[id]}
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
