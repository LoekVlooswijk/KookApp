import { Stack } from 'expo-router';

export default function RecipeCookStackLayout() {
  return (
    <Stack
      screenOptions={{
        title: 'Kookmodus',
        headerShown: true,
      }}
    >
      <Stack.Screen name="[id]" options={{ title: 'Kookmodus' }} />
    </Stack>
  );
}
