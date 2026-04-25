import { Stack, useRouter } from 'expo-router';
import { Platform, Pressable, StyleSheet, Text } from 'react-native';

export default function RecipeIdLayout() {
  const router = useRouter();

  return (
    <Stack
      screenOptions={{
        headerLeft: () => (
          <Pressable
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
              } else {
                router.replace('/');
              }
            }}
            style={styles.backBtn}
            hitSlop={{ top: 12, bottom: 12, right: 12, left: 4 }}
            accessibilityRole="button"
            accessibilityLabel="Terug"
          >
            <Text style={styles.backBtnGlyph}>{Platform.OS === 'ios' ? '‹' : '←'}</Text>
            <Text style={styles.backBtnLabel}>Terug</Text>
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
    color: '#2a6cb6',
    marginRight: Platform.OS === 'ios' ? -2 : 4,
  },
  backBtnLabel: { fontSize: 17, color: '#2a6cb6', fontWeight: '500' },
});
