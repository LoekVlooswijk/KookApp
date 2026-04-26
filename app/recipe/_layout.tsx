import { Stack } from 'expo-router';

export default function RecipeLayout() {
  return (
    <Stack>
      <Stack.Screen name="new" options={{ title: 'Nieuw recept' }} />
      <Stack.Screen name="preview" options={{ title: 'Controle' }} />
      <Stack.Screen name="import" options={{ title: 'Importeren' }} />
      <Stack.Screen name="cook" options={{ headerShown: false }} />
      <Stack.Screen name="[id]" options={{ headerShown: false }} />
    </Stack>
  );
}
