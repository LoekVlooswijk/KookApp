import { useFocusEffect } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation/elements';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
  addManagedCategory,
  deleteManagedCategoryEverywhere,
  getManagedCategoryUsageCount,
  listManagedCategories,
} from '../../lib/categoriesRepo';
import { addCustomDiet, getCustomDiets, removeCustomDiet } from '../../lib/dietPrefs';
import { ensureDatabaseAsync } from '../../lib/db';
import { cleanupAllRecipeMetadata } from '../../lib/recipeCleanup';
import {
  addManagedTag,
  deleteManagedTagEverywhere,
  getManagedTagUsageCount,
  listManagedTags,
} from '../../lib/tagsRepo';

export default function ManageMetadataSettingsScreen() {
  const theme = useAppTheme();
  const { confirm, ConfirmDialog } = useConfirmDialog();
  const web = Platform.OS === 'web';
  const headerHeight = useHeaderHeight();

  const [busy, setBusy] = useState(false);

  const [categories, setCategories] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [diets, setDiets] = useState<string[]>([]);

  const [newCategoryInput, setNewCategoryInput] = useState('');
  const [newTagInput, setNewTagInput] = useState('');
  const [newDietInput, setNewDietInput] = useState('');

  const reload = useCallback(() => {
    void (async () => {
      await ensureDatabaseAsync();
      const [cat, t, d] = await Promise.all([
        listManagedCategories(),
        listManagedTags(),
        getCustomDiets(),
      ]);
      setCategories(cat);
      setTags(t);
      setDiets(d.map((x) => x.name));
    })();
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  const sortedCategories = useMemo(
    () => [...categories].sort((a, b) => a.localeCompare(b, 'nl')),
    [categories]
  );
  const sortedTags = useMemo(() => [...tags].sort((a, b) => a.localeCompare(b, 'nl')), [tags]);
  const sortedDiets = useMemo(() => [...diets].sort((a, b) => a.localeCompare(b, 'nl')), [diets]);

  const onCleanupRecipes = useCallback(() => {
    void (async () => {
      const ok = await confirm({
        title: 'Recepten opschonen?',
        message:
          'Dit zet info op de juiste plek: dieet-tags → dieetvelden, categorie-tags → categorie, categorie-veld → tag als het geen bekende categorie is, ruis-tags en tags die hetzelfde zijn als een ingrediënt (bijv. venkel) worden verwijderd. Dit kan even duren.',
        confirmText: 'Opschonen',
        cancelText: 'Annuleren',
      });
      if (!ok) return;
      setBusy(true);
      try {
        const res = await cleanupAllRecipeMetadata();
        Alert.alert(
          'Klaar',
          `${res.updatedRecipes} recept${res.updatedRecipes === 1 ? '' : 'en'} bijgewerkt. ${res.removedTagLinks} tag-koppeling${res.removedTagLinks === 1 ? '' : 'en'} opgeschoond.`
        );
        reload();
      } catch (e) {
        Alert.alert('Fout', e instanceof Error ? e.message : 'Opschonen mislukt.');
      } finally {
        setBusy(false);
      }
    })();
  }, [confirm, reload]);

  const onAddCategory = useCallback(() => {
    const n = newCategoryInput.trim();
    if (!n) return;
    void (async () => {
      try {
        const next = await addManagedCategory(n);
        setCategories(next);
        setNewCategoryInput('');
      } catch (e) {
        Alert.alert('Fout', e instanceof Error ? e.message : 'Toevoegen mislukt.');
      }
    })();
  }, [newCategoryInput]);

  const onRemoveCategory = useCallback(
    (name: string) => {
      void (async () => {
        try {
          const usage = await getManagedCategoryUsageCount(name);
          const usageLine =
            usage > 0
              ? `Deze categorie staat nu bij ${usage} recept${usage === 1 ? '' : 'en'}. Verwijderen maakt de categorie leeg bij die recepten.`
              : 'Deze categorie wordt nu niet gebruikt in recepten.';
          const ok = await confirm({
            title: 'Categorie verwijderen?',
            message: `${usageLine}\n\n«${name}» verwijderen?`,
            confirmText: 'Verwijderen',
            cancelText: 'Annuleren',
            destructive: true,
          });
          if (!ok) return;
          try {
            await deleteManagedCategoryEverywhere(name);
            setCategories(await listManagedCategories());
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

  const onAddTag = useCallback(() => {
    const n = newTagInput.trim();
    if (!n) return;
    void (async () => {
      try {
        const next = await addManagedTag(n);
        setTags(next);
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
            setTags(await listManagedTags());
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

  const onAddDiet = useCallback(() => {
    const n = newDietInput.trim();
    if (!n) return;
    void (async () => {
      try {
        const next = await addCustomDiet(n);
        setDiets(next.map((d) => d.name));
        setNewDietInput('');
      } catch (e) {
        Alert.alert('Fout', e instanceof Error ? e.message : 'Toevoegen mislukt.');
      }
    })();
  }, [newDietInput]);

  const onRemoveDiet = useCallback(
    (name: string) => {
      void (async () => {
        const ok = await confirm({
          title: 'Dieet verwijderen?',
          message: `«${name}» verwijderen uit de lijst? Recepten die dit dieet nog als tag hebben blijven bestaan; je kunt daarna opschonen.`,
          confirmText: 'Verwijderen',
          cancelText: 'Annuleren',
          destructive: true,
        });
        if (!ok) return;
        const next = await removeCustomDiet(name);
        setDiets(next.map((d) => d.name));
      })();
    },
    [confirm]
  );

  return (
    <KeyboardAvoidingView
      style={[styles.scroll, { backgroundColor: theme.background }]}
      behavior={web ? undefined : Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={web ? 0 : headerHeight}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ConfirmDialog />
        <Text style={styles.section}>Beheren</Text>
        <Text style={styles.hint}>
          Hier beheer je categorieën, tags en extra diëten. Met “Recepten opschonen” worden
          bestaande recepten aangepast zodat informatie op de juiste plek staat.
          {web ? ' (Werkt ook op web.)' : ''}
        </Text>

        <Text style={styles.subSection}>Categorieën</Text>
        <Text style={styles.hint}>
          Categorie is één veld per recept (bijv. “hoofdgerecht”). Als een recept nu een categorie
          heeft die niet in deze lijst staat, kan opschonen die verplaatsen naar een tag.
        </Text>
        <View style={styles.row}>
          <TextInput
            style={[styles.input, styles.flex1]}
            placeholder="Bijv. soep"
            value={newCategoryInput}
            onChangeText={setNewCategoryInput}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Pressable
            style={[styles.btnPrimary, { backgroundColor: theme.accent }]}
            onPress={onAddCategory}
            disabled={!newCategoryInput.trim()}
          >
            <Text style={styles.btnPrimaryText}>Toevoegen</Text>
          </Pressable>
        </View>
        {sortedCategories.length > 0 ? (
          <View style={styles.chipRow}>
            {sortedCategories.map((c) => (
              <Pressable key={c} style={styles.chip} onPress={() => onRemoveCategory(c)}>
                <Text style={styles.chipText}>{c} ×</Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <Text style={styles.statusMuted}>Nog geen categorieën.</Text>
        )}

        <Text style={styles.subSection}>Tags</Text>
        <Text style={styles.hint}>
          Tags zijn vrije labels voor thema/keuken/techniek (bijv. “italiaans”, “airfryer”).
          Verwijderen haalt de tag ook weg bij recepten die hem gebruiken.
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
        {sortedTags.length > 0 ? (
          <View style={styles.chipRow}>
            {sortedTags.map((t) => (
              <Pressable key={t} style={styles.chip} onPress={() => onRemoveTag(t)}>
                <Text style={styles.chipText}>{t} ×</Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <Text style={styles.statusMuted}>Nog geen tags om te beheren.</Text>
        )}

        <Text style={styles.subSection}>Diëten</Text>
        <Text style={styles.hint}>
          Dit zijn extra dieetlabels naast de ingebouwde opties (Vega/Vegan/Keto). Ze worden
          opgeslagen als speciale tags (`diet:...`) zodat gewone tags voor thema/techniek blijven.
        </Text>
        <View style={styles.row}>
          <TextInput
            style={[styles.input, styles.flex1]}
            placeholder="Bijv. glutenvrij"
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
            <Text style={styles.btnPrimaryText}>Toevoegen</Text>
          </Pressable>
        </View>
        {sortedDiets.length > 0 ? (
          <View style={styles.chipRow}>
            {sortedDiets.map((d) => (
              <Pressable key={d} style={styles.chip} onPress={() => onRemoveDiet(d)}>
                <Text style={styles.chipText}>{d} ×</Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <Text style={styles.statusMuted}>Nog geen extra diëten toegevoegd.</Text>
        )}

        <View style={styles.divider} />

        <Pressable
          style={[styles.btnOutline, { borderColor: theme.accent }, busy && styles.btnDisabled]}
          onPress={onCleanupRecipes}
          disabled={busy}
        >
          <Text style={[styles.btnOutlineText, { color: theme.accent }]}>Recepten opschonen</Text>
        </Pressable>

        {busy ? (
          <View style={styles.busyRow}>
            <ActivityIndicator size="small" color={theme.accent} />
            <Text style={styles.busyHint}>Even geduld…</Text>
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  section: { fontSize: 17, fontWeight: '700', color: '#1a1a1a', marginTop: 20, marginBottom: 8 },
  subSection: { fontSize: 15, fontWeight: '800', color: '#1a1a1a', marginTop: 18, marginBottom: 6 },
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
  divider: { height: 1, backgroundColor: '#e8e4dc', marginTop: 18, marginBottom: 12 },
  btnDisabled: { opacity: 0.45 },
  btnOutline: {
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: '#fff',
    alignSelf: 'flex-start',
  },
  btnOutlineText: { fontWeight: '700', fontSize: 15 },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  busyHint: { fontSize: 14, color: '#666' },
});
