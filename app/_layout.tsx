import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ThemeProvider, useAppTheme } from '../components/ThemeContext';
import { hydrateAiCookProfileFromDb } from '../lib/aiCookProfile';
import { hydrateAiPrefsFromDb } from '../lib/aiPrefs';
import { hydrateAiRequestLogPrefsFromDb } from '../lib/aiRequestLogPrefs';
import { closeAndResetDatabaseConnectionAsync, ensureDatabaseAsync } from '../lib/db';
import { seedTechniquesIfEmpty } from '../lib/knowledgeSeeds';
import { hydrateBioScoreExcludePrefsFromDb } from '../lib/bioScoreExcludePrefs';
import { hydrateBioScoreOverridesPrefsFromDb } from '../lib/bioScoreOverridesPrefs';
import { hydrateBioScoreThresholdsFromDb } from '../lib/bioScoreThresholdsPrefs';
import { hydrateShoppingStaplesPrefsFromDb } from '../lib/shoppingStaplesPrefs';

function darkenColor(hex: string, factor: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.floor(((num >> 16) & 0xff) * factor);
  const g = Math.floor(((num >> 8) & 0xff) * factor);
  const b = Math.floor((num & 0xff) * factor);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function ThemedStack() {
  const theme = useAppTheme();
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
        <Stack.Screen name="settings/ai" options={{ title: 'AI' }} />
        <Stack.Screen name="settings/ai-debug" options={{ title: 'AI-debuglog' }} />
        <Stack.Screen name="settings/cook-profile-ai" options={{ title: 'Kookprofiel (AI)' }} />
        <Stack.Screen name="settings/shopping" options={{ title: 'Boodschappen' }} />
        <Stack.Screen name="settings/bio-score" options={{ title: 'Bio-score' }} />
        <Stack.Screen name="settings/bio-score-overrides" options={{ title: 'Productscores' }} />
        <Stack.Screen name="settings/appearance" options={{ title: 'Uiterlijk' }} />
        <Stack.Screen name="settings/diets" options={{ title: 'Dieten' }} />
        <Stack.Screen name="settings/tags" options={{ title: 'Tags' }} />
        <Stack.Screen name="settings/data" options={{ title: 'Databeheer' }} />
        <Stack.Screen name="recipe" options={{ headerShown: false }} />
        <Stack.Screen name="list" options={{ headerShown: false }} />
        <Stack.Screen name="kennis" options={{ headerShown: false }} />
      </Stack>
    </View>
  );
}

export default function RootLayout() {
  const [boot, setBoot] = useState<'loading' | 'ready' | 'fail'>('loading');
  const [failMessage, setFailMessage] = useState<string | null>(null);

  const hydrateAfterDb = useCallback(async () => {
    await hydrateAiPrefsFromDb();
    await hydrateAiCookProfileFromDb();
    await hydrateAiRequestLogPrefsFromDb();
    await hydrateShoppingStaplesPrefsFromDb();
    await hydrateBioScoreThresholdsFromDb();
    await hydrateBioScoreExcludePrefsFromDb();
    await hydrateBioScoreOverridesPrefsFromDb();
    await seedTechniquesIfEmpty();
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
          setFailMessage(e instanceof Error ? e.message : 'Onbekende fout.');
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
        setFailMessage(e instanceof Error ? e.message : 'Onbekende fout.');
        setBoot('fail');
      }
    })();
  }, [hydrateAfterDb]);

  if (boot === 'loading') {
    return (
      <GestureHandlerRootView style={styles.bootRoot}>
        <View style={styles.bootCenter}>
          <ActivityIndicator size="large" color="#c45c3e" />
          <Text style={styles.bootHint}>Database laden…</Text>
        </View>
      </GestureHandlerRootView>
    );
  }

  if (boot === 'fail') {
    return (
      <GestureHandlerRootView style={styles.bootRoot}>
        <View style={styles.failWrap}>
          <Text style={styles.failTitle}>Database niet beschikbaar</Text>
          <Text style={styles.failBody}>
            De app kan je lokale gegevens nu niet openen. Sluit andere vensters of probeer opnieuw.
          </Text>
          {failMessage ? <Text style={styles.failDetail}>{failMessage}</Text> : null}
          <Pressable style={styles.retryBtn} onPress={onRetryDatabase}>
            <Text style={styles.retryBtnText}>Opnieuw proberen</Text>
          </Pressable>
        </View>
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <ThemedStack />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  bootRoot: { flex: 1, backgroundColor: '#faf8f5' },
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
