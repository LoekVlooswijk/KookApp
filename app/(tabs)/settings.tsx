import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { MaterialIcons } from '@expo/vector-icons';

import { useAppTheme } from '../../components/ThemeContext';
import { useI18n } from '../../components/I18nContext';
import { type TranslationKey } from '../../lib/i18n';
import { hydrateAiCookProfileFromDb } from '../../lib/aiCookProfile';
import { hydrateAiPrefsFromDb } from '../../lib/aiPrefs';
import { ensureDatabaseAsync } from '../../lib/db';
import { hydrateBioScoreEnabledFromDb } from '../../lib/bioScoreEnabledPrefs';
import { hydrateBioScoreExcludePrefsFromDb } from '../../lib/bioScoreExcludePrefs';
import { hydrateBioScoreOverridesPrefsFromDb } from '../../lib/bioScoreOverridesPrefs';
import { hydrateBioScoreThresholdsFromDb } from '../../lib/bioScoreThresholdsPrefs';
import { hydrateShoppingOrganicPrefsFromDb } from '../../lib/shoppingOrganicPrefs';
import { hydrateShoppingStaplesPrefsFromDb } from '../../lib/shoppingStaplesPrefs';

const version = Constants.expoConfig?.version ?? '0.0.0';

type Section = {
  id: string;
  titleKey: TranslationKey;
  first?: boolean;
  rows: {
    key: string;
    titleKey: TranslationKey;
    subtitleKey: TranslationKey;
    /** Optionele extra regel op web (b.v. "Op web alleen bekijken."). */
    subtitleWebKey?: TranslationKey;
    href: string;
    icon: keyof typeof MaterialIcons.glyphMap;
    titleColor?: string;
    iconColorKey?: 'accent' | 'destructive';
  }[];
};

const SECTIONS: Section[] = [
  {
    id: 'ai',
    titleKey: 'settings.sections.ai',
    first: true,
    rows: [
      {
        key: 'ai',
        titleKey: 'settings.rows.ai.title',
        subtitleKey: 'settings.rows.ai.subtitle',
        href: '/settings/ai',
        icon: 'smart-toy',
      },
      {
        key: 'ai_debug',
        titleKey: 'settings.rows.aiDebug.title',
        subtitleKey: 'settings.rows.aiDebug.subtitle',
        href: '/settings/ai-debug',
        icon: 'bug-report',
      },
      {
        key: 'cook',
        titleKey: 'settings.rows.cook.title',
        subtitleKey: 'settings.rows.cook.subtitle',
        href: '/settings/cook-profile-ai',
        icon: 'restaurant-menu',
      },
    ],
  },
  {
    id: 'app',
    titleKey: 'settings.sections.app',
    rows: [
      {
        key: 'appearance',
        titleKey: 'settings.rows.appearance.title',
        subtitleKey: 'settings.rows.appearance.subtitle',
        href: '/settings/appearance',
        icon: 'palette',
      },
    ],
  },
  {
    id: 'recepten',
    titleKey: 'settings.sections.recipes',
    rows: [
      {
        key: 'shopping',
        titleKey: 'settings.rows.shopping.title',
        subtitleKey: 'settings.rows.shopping.subtitle',
        href: '/settings/shopping',
        icon: 'shopping-cart',
      },
      {
        key: 'bio_score',
        titleKey: 'settings.rows.bioScore.title',
        subtitleKey: 'settings.rows.bioScore.subtitle',
        href: '/settings/bio-score',
        icon: 'eco',
      },
      {
        key: 'beheren',
        titleKey: 'settings.rows.beheren.title',
        subtitleKey: 'settings.rows.beheren.subtitle',
        href: '/settings/beheren',
        icon: 'category',
      },
    ],
  },
  {
    id: 'advanced',
    titleKey: 'settings.sections.advanced',
    rows: [
      {
        key: 'data',
        titleKey: 'settings.rows.data.title',
        subtitleKey: 'settings.rows.data.subtitle',
        subtitleWebKey: 'settings.rows.data.subtitleWeb',
        href: '/settings/data',
        icon: 'storage',
        titleColor: '#9a3d3d',
        iconColorKey: 'destructive',
      },
    ],
  },
];

export default function SettingsScreen() {
  const theme = useAppTheme();
  const router = useRouter();
  const { t } = useI18n();

  const reloadPrefs = useCallback(() => {
    void (async () => {
      await ensureDatabaseAsync();
      await hydrateAiPrefsFromDb();
      await hydrateAiCookProfileFromDb();
      await hydrateShoppingStaplesPrefsFromDb();
      await hydrateShoppingOrganicPrefsFromDb();
      await hydrateBioScoreThresholdsFromDb();
      await hydrateBioScoreEnabledFromDb();
      await hydrateBioScoreExcludePrefsFromDb();
      await hydrateBioScoreOverridesPrefsFromDb();
    })();
  }, []);

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
      {SECTIONS.map((section) => (
        <View key={section.id}>
          <Text
            style={[styles.sectionHeader, (section.first ?? false) && styles.sectionHeaderFirst]}
          >
            {t(section.titleKey)}
          </Text>
          {section.rows.map((row) => {
            const iconC = row.iconColorKey === 'destructive' ? '#9a3d3d' : theme.accent;
            return (
              <Pressable
                key={row.key}
                style={[styles.navRow, { borderColor: theme.accentBorderMuted }]}
                onPress={() => router.push(row.href as never)}
              >
                <MaterialIcons name={row.icon} size={22} color={iconC} style={styles.navIcon} />
                <View style={styles.navRowMain}>
                  <Text
                    style={[
                      styles.navRowTitle,
                      row.titleColor != null && { color: row.titleColor },
                    ]}
                  >
                    {t(row.titleKey)}
                  </Text>
                  <Text style={styles.navRowSubtitle}>
                    {t(row.subtitleKey)}
                    {Platform.OS === 'web' && row.subtitleWebKey != null
                      ? ` ${t(row.subtitleWebKey)}`
                      : ''}
                  </Text>
                </View>
                <Text style={[styles.navRowHint, { color: theme.accent }]}>›</Text>
              </Pressable>
            );
          })}
        </View>
      ))}
      <Text style={styles.versionFooter}>{t('settings.footer', { version })}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  sectionHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 18,
    marginBottom: 8,
  },
  sectionHeaderFirst: { marginTop: 0 },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#e2ddd5',
    borderRadius: 12,
    backgroundColor: '#fff',
    marginBottom: 12,
  },
  navIcon: { marginTop: 0 },
  navRowMain: { flex: 1, minWidth: 0, gap: 2 },
  navRowTitle: { fontSize: 15, fontWeight: '700', color: '#1a1a1a' },
  navRowSubtitle: { fontSize: 13, color: '#8a8a8a', lineHeight: 18 },
  navRowHint: { fontSize: 18, fontWeight: '900', paddingTop: 2 },
  versionFooter: { fontSize: 12, color: '#aaa', textAlign: 'center', marginTop: 24 },
});
