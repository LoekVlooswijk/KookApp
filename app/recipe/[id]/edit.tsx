import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { useI18n } from '../../../components/I18nContext';
import { RecipeForm } from '../../../components/RecipeForm';

export default function RecipeEditScreen() {
  const { id: idParam } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const recipeId = Number.parseInt(idParam ?? '', 10);

  if (!Number.isFinite(recipeId)) {
    return (
      <View style={styles.center}>
        <Text>{t('recipes.common.invalidRecipe')}</Text>
      </View>
    );
  }

  return <RecipeForm recipeId={recipeId} />;
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});
