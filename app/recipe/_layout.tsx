import { Stack } from 'expo-router';
import { useAppTheme } from '../../components/ThemeContext';
import { useI18n } from '../../components/I18nContext';

function darkenColor(hex: string, factor: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.floor(((num >> 16) & 0xff) * factor);
  const g = Math.floor(((num >> 8) & 0xff) * factor);
  const b = Math.floor((num & 0xff) * factor);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export default function RecipeLayout() {
  const theme = useAppTheme();
  const { t } = useI18n();
  return (
    <Stack
      screenOptions={{
        headerTintColor: theme.accent,
        headerStyle: { backgroundColor: darkenColor(theme.background, 0.97) },
      }}
    >
      <Stack.Screen name="new" options={{ title: t('recipes.layout.new') }} />
      <Stack.Screen name="preview" options={{ title: t('recipes.layout.preview') }} />
      <Stack.Screen name="import" options={{ title: t('recipes.layout.import') }} />
      <Stack.Screen name="cook" options={{ headerShown: false }} />
      <Stack.Screen name="[id]" options={{ headerShown: false }} />
    </Stack>
  );
}
