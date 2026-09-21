import { Stack, useRouter } from 'expo-router';
import { Platform, Pressable, StyleSheet, Text } from 'react-native';
import { useAppTheme } from '../../../components/ThemeContext';

function darkenColor(hex: string, factor: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.floor(((num >> 16) & 0xff) * factor);
  const g = Math.floor(((num >> 8) & 0xff) * factor);
  const b = Math.floor((num & 0xff) * factor);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export default function RecipeIdLayout() {
  const router = useRouter();
  const theme = useAppTheme();

  return (
    <Stack
      screenOptions={{
        headerTintColor: theme.accent,
        headerStyle: { backgroundColor: darkenColor(theme.background, 0.97) },
        headerLeft: () => (
          <Pressable
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
              } else {
                router.replace('/(tabs)/recipes');
              }
            }}
            style={styles.backBtn}
            hitSlop={{ top: 12, bottom: 12, right: 12, left: 4 }}
            accessibilityRole="button"
            accessibilityLabel="Terug"
          >
            <Text style={[styles.backBtnGlyph, { color: theme.accent }]}>
              {Platform.OS === 'ios' ? '‹' : '←'}
            </Text>
            <Text style={[styles.backBtnLabel, { color: theme.accent }]}>Terug</Text>
          </Pressable>
        ),
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Recept' }} />
      <Stack.Screen name="edit" options={{ title: 'Bewerken' }} />
    </Stack>
  );
}

const styles = StyleSheet.create({
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingLeft: 4,
    paddingRight: 8,
    gap: 2,
  },
  backBtnGlyph: {
    fontSize: Platform.OS === 'ios' ? 28 : 18,
    lineHeight: Platform.OS === 'ios' ? 32 : 22,
    fontWeight: Platform.OS === 'ios' ? '400' : '700',
    marginRight: Platform.OS === 'ios' ? -2 : 4,
  },
  backBtnLabel: { fontSize: 17, fontWeight: '500' },
});
