import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ThemeProvider, useAppTheme } from '../components/ThemeContext';
import { hydrateAiCookProfileFromDb } from '../lib/aiCookProfile';
import { hydrateAiPrefsFromDb } from '../lib/aiPrefs';
import { ensureDatabaseAsync } from '../lib/db';
import { hydrateShoppingStaplesPrefsFromDb } from '../lib/shoppingStaplesPrefs';

function ThemedStack() {
  const theme = useAppTheme();
  return (
    <>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerTintColor: theme.accent,
          headerTitleStyle: { color: '#1a1a1a' },
          contentStyle: { backgroundColor: theme.background },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="settings/ai" options={{ title: 'AI' }} />
        <Stack.Screen name="settings/cook-profile-ai" options={{ title: 'Kookprofiel (AI)' }} />
        <Stack.Screen name="settings/shopping" options={{ title: 'Boodschappen' }} />
        <Stack.Screen name="settings/appearance" options={{ title: 'Uiterlijk' }} />
        <Stack.Screen name="settings/diets" options={{ title: 'Dieten' }} />
        <Stack.Screen name="settings/tags" options={{ title: 'Tags' }} />
        <Stack.Screen name="settings/data" options={{ title: 'Databeheer' }} />
        <Stack.Screen name="recipe" options={{ headerShown: false }} />
        <Stack.Screen name="list" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  useEffect(() => {
    void (async () => {
      try {
        await ensureDatabaseAsync();
        await hydrateAiPrefsFromDb();
        await hydrateAiCookProfileFromDb();
        await hydrateShoppingStaplesPrefsFromDb();
      } catch (e) {
        console.error(e);
      }
    })();
  }, []);

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
