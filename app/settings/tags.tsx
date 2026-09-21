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
import {
  addManagedTag,
  deleteManagedTagEverywhere,
  getManagedTagUsageCount,
  listManagedTags,
} from '../../lib/tagsRepo';
import { ensureDatabaseAsync } from '../../lib/db';

export default function TagsSettingsScreen() {
  const theme = useAppTheme();
  const { confirm, ConfirmDialog } = useConfirmDialog();
  const headerHeight = useHeaderHeight();

  const [managedTags, setManagedTags] = useState<string[]>([]);
  const [newTagInput, setNewTagInput] = useState('');

  const reload = useCallback(() => {
    void (async () => {
      await ensureDatabaseAsync();
      setManagedTags(await listManagedTags());
    })();
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  const onAddTag = useCallback(() => {
    const n = newTagInput.trim();
    if (!n) return;
    void (async () => {
      try {
        const next = await addManagedTag(n);
        setManagedTags(next);
        setNewTagInput('');
      } catch (e) {
        Alert.alert('Fout', e instanceof Error ? e.message : 'Toevoegen mislukt.');
      }
    })();
  }, [newTagInput]);

  const onRemoveTag = useCallback(
    (name: string) => {
      void (async () => {
        try {
          const usage = await getManagedTagUsageCount(name);
          const usageLine =
            usage > 0
              ? `Deze tag wordt nu gebruikt bij ${usage} recept${usage === 1 ? '' : 'en'}. Verwijderen haalt hem weg bij al die recepten.`
              : 'Deze tag wordt nu niet gebruikt in recepten.';
          const ok = await confirm({
            title: 'Tag verwijderen?',
            message: `${usageLine}\n\n«${name}» verwijderen?`,
            confirmText: 'Verwijderen',
            cancelText: 'Annuleren',
            destructive: true,
          });
          if (!ok) return;
          try {
            await deleteManagedTagEverywhere(name);
            setManagedTags(await listManagedTags());
          } catch (e) {
            Alert.alert('Fout', e instanceof Error ? e.message : 'Verwijderen mislukt.');
          }
        } catch (e) {
          Alert.alert('Fout', e instanceof Error ? e.message : 'Verwijderen mislukt.');
        }
      })();
    },
    [confirm]
  );

  return (
    <KeyboardAvoidingView
      style={[styles.scroll, { backgroundColor: theme.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={headerHeight}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ConfirmDialog />
        <Text style={styles.section}>Tags beheren</Text>
        <Text style={styles.hint}>
          Voeg hier tags toe voor thema/keuken/techniek (bijv. “italiaans”, “airfryer”). Verwijderen
          haalt de tag ook weg bij recepten die hem gebruiken.
        </Text>

        <View style={styles.row}>
          <TextInput
            style={[styles.input, styles.flex1]}
            placeholder="Bijv. italiaans"
            value={newTagInput}
            onChangeText={setNewTagInput}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Pressable
            style={[styles.btnPrimary, { backgroundColor: theme.accent }]}
            onPress={onAddTag}
            disabled={!newTagInput.trim()}
          >
            <Text style={styles.btnPrimaryText}>Toevoegen</Text>
          </Pressable>
        </View>

        {managedTags.length > 0 ? (
          <View style={styles.chipRow}>
            {managedTags.map((t) => (
              <Pressable key={t} style={styles.chip} onPress={() => onRemoveTag(t)}>
                <Text style={styles.chipText}>{t} ×</Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <Text style={styles.statusMuted}>Nog geen tags om te beheren.</Text>
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
