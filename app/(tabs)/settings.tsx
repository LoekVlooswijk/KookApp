import { useFocusEffect } from 'expo-router';
import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { MaterialIcons } from '@expo/vector-icons';

import { useAppTheme } from '../../components/ThemeContext';
import { hydrateAiCookProfileFromDb } from '../../lib/aiCookProfile';
import { hydrateAiPrefsFromDb } from '../../lib/aiPrefs';
import { ensureDatabaseAsync } from '../../lib/db';
import { hydrateBioScoreExcludePrefsFromDb } from '../../lib/bioScoreExcludePrefs';
import { hydrateBioScoreOverridesPrefsFromDb } from '../../lib/bioScoreOverridesPrefs';
import { hydrateBioScoreThresholdsFromDb } from '../../lib/bioScoreThresholdsPrefs';
import { hydrateShoppingOrganicPrefsFromDb } from '../../lib/shoppingOrganicPrefs';
import { hydrateShoppingStaplesPrefsFromDb } from '../../lib/shoppingStaplesPrefs';

const version = Constants.expoConfig?.version ?? '0.0.0';

type Section = {
  id: string;
  title: string;
  first?: boolean;
  rows: Array<{
    key: string;
    title: string;
    subtitle: string;
    href: string;
    icon: keyof typeof MaterialIcons.glyphMap;
    titleColor?: string;
    iconColorKey?: 'accent' | 'destructive';
  }>;
};

const SECTIONS: Section[] = [
  {
    id: 'ai',
    title: 'AI',
    first: true,
    rows: [
      {
        key: 'ai',
        title: 'AI-instellingen',
        subtitle: 'Beheer providers, sleutels en modelkeuze.',
        href: '/settings/ai',
        icon: 'smart-toy',
      },
      {
        key: 'ai_debug',
        title: 'AI-debuglog',
        subtitle: 'Recente Anthropic-aanroepen (optioneel, lokaal in geheugen).',
        href: '/settings/ai-debug',
        icon: 'bug-report',
      },
      {
        key: 'cook',
        title: 'Kookprofiel (AI)',
        subtitle: 'Allergieën, dislikes en voorkeuren voor AI-antwoorden.',
        href: '/settings/cook-profile-ai',
        icon: 'restaurant-menu',
      },
    ],
  },
  {
    id: 'app',
    title: 'App',
    rows: [
      {
        key: 'appearance',
        title: 'Uiterlijk',
        subtitle: 'Accentkleur en achtergrond.',
        href: '/settings/appearance',
        icon: 'palette',
      },
    ],
  },
  {
    id: 'recepten',
    title: 'Recepten & boodschappen',
    rows: [
      {
        key: 'shopping',
        title: 'Boodschappen',
        subtitle: 'Wat staat al thuis + wat altijd biologisch moet.',
        href: '/settings/shopping',
        icon: 'shopping-cart',
      },
      {
        key: 'bio_score',
        title: 'Bio-score',
        subtitle: 'Drempels, uitsluitingen, vaste productscores en bulk berekenen.',
        href: '/settings/bio-score',
        icon: 'eco',
      },
      {
        key: 'beheren',
        title: 'Beheren',
        subtitle: 'Categorieën, tags, diëten en opschoonacties.',
        href: '/settings/beheren',
        icon: 'category',
      },
    ],
  },
  {
    id: 'advanced',
    title: 'Geavanceerd',
    rows: [
      {
        key: 'data',
        title: 'Databeheer',
        subtitle: `Backup, importeren, opschonen en alles wissen${
          Platform.OS === 'web' ? '. Op web alleen bekijken.' : '.'
        }`,
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

  const reloadPrefs = useCallback(() => {
    void (async () => {
      await ensureDatabaseAsync();
      await hydrateAiPrefsFromDb();
      await hydrateAiCookProfileFromDb();
      await hydrateShoppingStaplesPrefsFromDb();
      await hydrateShoppingOrganicPrefsFromDb();
      await hydrateBioScoreThresholdsFromDb();
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
            {section.title}
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
                    {row.title}
                  </Text>
                  <Text style={styles.navRowSubtitle}>{row.subtitle}</Text>
                </View>
                <Text style={[styles.navRowHint, { color: theme.accent }]}>›</Text>
              </Pressable>
            );
          })}
        </View>
      ))}
      <Text style={styles.versionFooter}>{`Kookapp v${version}`}</Text>
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
