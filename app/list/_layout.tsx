import { Stack } from 'expo-router';

export default function ListStackLayout() {
  return (
    <Stack>
      <Stack.Screen name="[id]" options={{ title: 'Lijst' }} />
    </Stack>
  );
}
