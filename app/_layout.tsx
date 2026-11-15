import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { FirstRunLanguagePicker } from '../components/FirstRunLanguagePicker';
import { I18nProvider, useI18n } from '../components/I18nContext';
import { ThemeProvider, useAppTheme } from '../components/ThemeContext';
import { hydrateAiCookProfileFromDb } from '../lib/aiCookProfile';
import { hydrateAiPrefsFromDb } from '../lib/aiPrefs';
import { hydrateAiRequestLogPrefsFromDb } from '../lib/aiRequestLogPrefs';
import { closeAndResetDatabaseConnectionAsync, ensureDatabaseAsync } from '../lib/db';
import { seedCookingTimesIfEmpty, seedTechniquesIfEmpty } from '../lib/knowledgeSeeds';
import { hydrateBioScoreEnabledFromDb } from '../lib/bioScoreEnabledPrefs';
import { hydrateBioScoreExcludePrefsFromDb } from '../lib/bioScoreExcludePrefs';
import { hydrateBioScoreOverridesPrefsFromDb } from '../lib/bioScoreOverridesPrefs';
import { hydrateBioScoreThresholdsFromDb } from '../lib/bioScoreThresholdsPrefs';
import { hydrateShoppingStaplesPrefsFromDb } from '../lib/shoppingStaplesPrefs';

type BootState = 'loading' | 'ready' | 'fail';

function darkenColor(hex: string, factor: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.floor(((num >> 16) & 0xff) * factor);
  const g = Math.floor(((num >> 8) & 0xff) * factor);
  const b = Math.floor((num & 0xff) * factor);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function ThemedStack() {
  const theme = useAppTheme();
  const { t } = useI18n();
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: darkenColor(theme.background, 0.97) },
          headerTitleStyle: { color: '#1a1a1a' },
          contentStyle: { backgroundColor: theme.background },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="settings/ai" options={{ title: t('headers.ai') }} />
        <Stack.Screen name="settings/ai-debug" options={{ title: t('headers.aiDebug') }} />
        <Stack.Screen
          name="settings/cook-profile-ai"
          options={{ title: t('headers.cookProfile') }}
        />
        <Stack.Screen name="settings/shopping" options={{ title: t('headers.shopping') }} />
        <Stack.Screen name="settings/bio-score" options={{ title: t('headers.bioScore') }} />
        <Stack.Screen
          name="settings/bio-score-overrides"
          options={{ title: t('headers.bioScoreOverrides') }}
        />
        <Stack.Screen name="settings/appearance" options={{ title: t('headers.appearance') }} />
        <Stack.Screen name="settings/diets" options={{ title: t('headers.diets') }} />
        <Stack.Screen name="settings/tags" options={{ title: t('headers.tags') }} />
        <Stack.Screen name="settings/data" options={{ title: t('headers.data') }} />
        <Stack.Screen name="recipe" options={{ headerShown: false }} />
        <Stack.Screen name="list" options={{ headerShown: false }} />
        <Stack.Screen name="kennis" options={{ headerShown: false }} />
      </Stack>
    </View>
  );
}

function AppShell({
  boot,
  failMessage,
  onRetry,
}: {
  boot: BootState;
  failMessage: string | null;
  onRetry: () => void;
}) {
  const { t, languageId, languageReady } = useI18n();
  const theme = useAppTheme();

  if (boot === 'loading') {
    return (
      <View style={[styles.bootRoot, { backgroundColor: theme.background }]}>
        <View style={styles.bootCenter}>
          <ActivityIndicator size="large" color="#c45c3e" />
          <Text style={styles.bootHint}>{t('boot.loading')}</Text>
        </View>
      </View>
    );
  }

  if (boot === 'fail') {
    return (
      <View style={[styles.bootRoot, { backgroundColor: theme.background }]}>
        <View style={styles.failWrap}>
          <Text style={styles.failTitle}>{t('boot.failTitle')}</Text>
          <Text style={styles.failBody}>{t('boot.failBody')}</Text>
          {failMessage ? <Text style={styles.failDetail}>{failMessage}</Text> : null}
          <Pressable style={styles.retryBtn} onPress={onRetry}>
            <Text style={styles.retryBtnText}>{t('boot.retry')}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <>
      <ThemedStack />
      {languageReady && languageId == null ? <FirstRunLanguagePicker /> : null}
    </>
  );
}

export default function RootLayout() {
  const [boot, setBoot] = useState<BootState>('loading');
  const [failMessage, setFailMessage] = useState<string | null>(null);

  const hydrateAfterDb = useCallback(async () => {
    await hydrateAiPrefsFromDb();
    await hydrateAiCookProfileFromDb();
    await hydrateAiRequestLogPrefsFromDb();
    await hydrateShoppingStaplesPrefsFromDb();
    await hydrateBioScoreThresholdsFromDb();
    await hydrateBioScoreEnabledFromDb();
    await hydrateBioScoreExcludePrefsFromDb();
    await hydrateBioScoreOverridesPrefsFromDb();
    await seedTechniquesIfEmpty();
    await seedCookingTimesIfEmpty();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await ensureDatabaseAsync();
        await hydrateAfterDb();
        if (!cancelled) {
          setFailMessage(null);
          setBoot('ready');
        }
      } catch (e) {
        if (!cancelled) {
          setFailMessage(e instanceof Error ? e.message : null);
          setBoot('fail');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrateAfterDb]);

  const onRetryDatabase = useCallback(() => {
    setBoot('loading');
    setFailMessage(null);
    void (async () => {
      try {
        await closeAndResetDatabaseConnectionAsync();
        await ensureDatabaseAsync();
        await hydrateAfterDb();
        setBoot('ready');
      } catch (e) {
        setFailMessage(e instanceof Error ? e.message : null);
        setBoot('fail');
      }
    })();
  }, [hydrateAfterDb]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <I18nProvider>
          <ThemeProvider>
            <AppShell boot={boot} failMessage={failMessage} onRetry={onRetryDatabase} />
          </ThemeProvider>
        </I18nProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  bootRoot: { flex: 1 },
  bootCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  bootHint: { fontSize: 14, color: '#666' },
  failWrap: { flex: 1, justifyContent: 'center', padding: 24 },
  failTitle: { fontSize: 20, fontWeight: '700', color: '#1a1a1a', marginBottom: 12 },
  failBody: { fontSize: 15, color: '#444', lineHeight: 22, marginBottom: 8 },
  failDetail: { fontSize: 13, color: '#888', marginBottom: 20 },
  retryBtn: {
    alignSelf: 'flex-start',
    backgroundColor: '#c45c3e',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
  },
  retryBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
