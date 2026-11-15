import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { CookingView } from '../../../components/CookingView';
import { useI18n } from '../../../components/I18nContext';

export default function RecipeCookScreen() {
  const { t } = useI18n();
  const { id: idParam } = useLocalSearchParams<{ id: string }>();
  const recipeId = Number.parseInt(idParam ?? '', 10);

  if (!Number.isFinite(recipeId)) {
    return (
      <View style={styles.center}>
        <Text>{t('cook.screen.invalidRecipe')}</Text>
      </View>
    );
  }

  return <CookingView recipeId={recipeId} />;
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});
