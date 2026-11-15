import { useFocusEffect } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation/elements';
import { useCallback, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useConfirmDialog } from '../../components/ConfirmDialog';
import { useAppTheme } from '../../components/ThemeContext';
import { useI18n } from '../../components/I18nContext';
import { addCustomDiet, getCustomDiets, removeCustomDiet } from '../../lib/dietPrefs';
import { ensureDatabaseAsync } from '../../lib/db';

export default function DietsSettingsScreen() {
  const theme = useAppTheme();
  const { t } = useI18n();
  const { confirm, ConfirmDialog } = useConfirmDialog();
  const headerHeight = useHeaderHeight();

  const [customDiets, setCustomDietsState] = useState<string[]>([]);
  const [newDietInput, setNewDietInput] = useState('');

  const reload = useCallback(() => {
    void (async () => {
      await ensureDatabaseAsync();
      setCustomDietsState((await getCustomDiets()).map((d) => d.name));
    })();
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  const onAddDiet = useCallback(() => {
    const n = newDietInput.trim();
    if (!n) return;
    void (async () => {
      try {
        const next = await addCustomDiet(n);
        setCustomDietsState(next.map((d) => d.name));
        setNewDietInput('');
      } catch (e) {
        Alert.alert(
          t('settings.shared.errorTitle'),
          e instanceof Error ? e.message : t('settings.shared.addFailed')
        );
      }
    })();
  }, [newDietInput, t]);

  const onRemoveDiet = useCallback(
    (name: string) => {
      void (async () => {
        const ok = await confirm({
          title: t('settings.dietsPage.deleteTitle'),
          message: t('settings.dietsPage.deleteMessage', { name }),
          confirmText: t('settings.shared.delete'),
          cancelText: t('common.confirm.cancel'),
          destructive: true,
        });
        if (!ok) return;
        const next = await removeCustomDiet(name);
        setCustomDietsState(next.map((d) => d.name));
      })();
    },
    [confirm, t]
  );

  return (
    <KeyboardAvoidingView
      style={[styles.scroll, { backgroundColor: theme.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={headerHeight}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ConfirmDialog />
        <Text style={styles.section}>{t('settings.dietsPage.title')}</Text>
        <Text style={styles.hint}>{t('settings.dietsPage.hint')}</Text>

        <View style={styles.row}>
          <TextInput
            style={[styles.input, styles.flex1]}
            placeholder={t('settings.dietsPage.placeholder')}
            value={newDietInput}
            onChangeText={setNewDietInput}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Pressable
            style={[styles.btnPrimary, { backgroundColor: theme.accent }]}
            onPress={onAddDiet}
            disabled={!newDietInput.trim()}
          >
            <Text style={styles.btnPrimaryText}>{t('settings.shared.add')}</Text>
          </Pressable>
        </View>

        {customDiets.length > 0 ? (
          <View style={styles.chipRow}>
            {customDiets.map((d) => (
              <Pressable key={d} style={styles.chip} onPress={() => onRemoveDiet(d)}>
                <Text style={styles.chipText}>{d} ×</Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <Text style={styles.statusMuted}>{t('settings.dietsPage.empty')}</Text>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  section: { fontSize: 17, fontWeight: '700', color: '#1a1a1a', marginTop: 20, marginBottom: 8 },
  hint: { fontSize: 13, color: '#666', lineHeight: 19, marginBottom: 10 },
  statusMuted: { fontSize: 14, color: '#888', marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: '#e2ddd5',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    backgroundColor: '#fff',
    color: '#1a1a1a',
    marginBottom: 12,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 8 },
  flex1: { flex: 1, minWidth: 180 },
  btnPrimary: {
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 8,
  },
  btnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#e2ddd5',
    backgroundColor: '#fff',
  },
  chipText: { fontSize: 14, color: '#444', fontWeight: '600' },
});
