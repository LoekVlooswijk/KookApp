import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useAppTheme } from '../../components/ThemeContext';
import { ensureDatabaseAsync } from '../../lib/db';
import { safeErrorMessage } from '../../lib/logSafe';
import { getStartTabHref } from '../../lib/startTabPrefs';

/**
 * Cold launch lands on `/(tabs)` → this route reads the start-tab preference and replaces
 * with the chosen tab. The tab bar item for this route is hidden (`href: null`).
 */
export default function TabsStartGate() {
  const router = useRouter();
  const theme = useAppTheme();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await ensureDatabaseAsync();
        const href = await getStartTabHref();
        if (!cancelled) {
          router.replace(href);
        }
      } catch (e) {
        console.error(safeErrorMessage(e));
        if (!cancelled) {
          router.replace('/(tabs)/shopping');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <ActivityIndicator size="large" color={theme.accent} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
