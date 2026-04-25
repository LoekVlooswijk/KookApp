import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { RecipeForm } from '../../../components/RecipeForm';

export default function RecipeEditScreen() {
  const { id: idParam } = useLocalSearchParams<{ id: string }>();
  const recipeId = Number.parseInt(idParam ?? '', 10);

  if (!Number.isFinite(recipeId)) {
    return (
      <View style={styles.center}>
        <Text>Ongeldig recept.</Text>
      </View>
    );
  }

  return <RecipeForm recipeId={recipeId} />;
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});
