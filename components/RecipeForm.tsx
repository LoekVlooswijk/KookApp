import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  type NavigationAction,
  useNavigation,
  usePreventRemove,
} from '@react-navigation/native';
import { useAppTheme } from './ThemeContext';
import { disposeImportSession, getImportSession } from '../lib/importDraft';
import { isAppManagedCoverUri, persistPickedRecipeCover, tryDeleteManagedCover } from '../lib/recipeCoverStorage';
import { getCustomDiets } from '../lib/dietPrefs';
import { addManagedCategory, listManagedCategories } from '../lib/categoriesRepo';
import { addRecipeToList } from '../lib/listsRepo';
import { timerSecondsToMinuteDraftStr } from '../lib/timerFormat';
import type { RecipeSavePayload } from '../lib/types';
import {
  createRecipe,
  fullRecipeToPayload,
  getFullRecipe,
  listDistinctRecipeCategories,
  listDistinctRecipeTags,
  updateRecipe,
} from '../lib/recipesRepo';

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

type DraftIngredient = { id: string; name: string; amount: string; unit: string };
type DraftGroup = { id: string; title: string; ingredients: DraftIngredient[] };
type DraftStep = {
  id: string;
  description: string;
  timerMin: string;
  /** When false, timer input is hidden until user taps the timer button. */
  showTimerField: boolean;
};
type DraftSection = { id: string; title: string; steps: DraftStep[] };

function emptyDraft(): { groups: DraftGroup[]; sections: DraftSection[] } {
  return {
    groups: [
      {
        id: newId(),
        title: '',
        ingredients: [{ id: newId(), name: '', amount: '', unit: '' }],
      },
    ],
    sections: [
      {
        id: newId(),
        title: '',
        steps: [{ id: newId(), description: '', timerMin: '', showTimerField: false }],
      },
    ],
  };
}

function parseAmount(s: string): number | null {
  const t = s.trim().replace(',', '.');
  if (!t) return null;
  const n = Number.parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

function stepHasTimerMinutes(st: DraftStep): boolean {
  const m = parseAmount(st.timerMin);
  return m != null && m > 0;
}

function parseIntOrNull(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number.parseInt(t, 10);
  return Number.isFinite(n) ? n : null;
}

function buildPayload(
  title: string,
  description: string,
  sourceUrl: string,
  baseServingsStr: string,
  prepStr: string,
  cookStr: string,
  totalStr: string,
  category: string,
  dietVegetarian: boolean,
  dietVegan: boolean,
  dietKeto: boolean,
  isFavorite: boolean,
  wantToTry: boolean,
  notes: string,
  imageUri: string,
  tagsStr: string,
  customDietNames: string[],
  groups: DraftGroup[],
  sections: DraftSection[]
): RecipeSavePayload {
  const base = Number.parseInt(baseServingsStr.trim(), 10);
  const baseTags = tagsStr
    .split(/[,;]/)
    .map((t) => t.trim())
    .filter(Boolean);
  const dietTokens = (customDietNames ?? [])
    .map((d) => d.trim().toLowerCase().replace(/\s+/g, ' '))
    .filter(Boolean)
    .map((d) => `diet:${d}`);
  const tagNames = [...baseTags, ...dietTokens];
  return {
    title,
    description,
    sourceUrl,
    baseServings: Number.isFinite(base) && base > 0 ? base : 4,
    prepTimeMin: parseIntOrNull(prepStr),
    cookTimeMin: parseIntOrNull(cookStr),
    totalTimeMin: parseIntOrNull(totalStr),
    category,
    dietVegetarian,
    dietVegan,
    dietKeto,
    isFavorite,
    wantToTry,
    notes,
    imageUri,
    tagNames,
    ingredientGroups: groups.map((g) => ({
      title: g.title,
      ingredients: g.ingredients.map((i) => ({
        name: i.name,
        amount: parseAmount(i.amount),
        unit: i.unit.trim() || null,
      })),
    })),
    stepSections: sections.map((s) => ({
      title: s.title,
      steps: s.steps.map((st) => {
        const minutes = parseAmount(st.timerMin);
        let timerSeconds: number | null = null;
        if (minutes != null && minutes > 0) {
          timerSeconds = Math.max(1, Math.round(minutes * 60));
        }
        return {
          description: st.description,
          timerSeconds,
        };
      }),
    })),
  };
}

type Props = {
  recipeId?: number;
  /** Sessie-id uit URL-import (`importSid`); payload blijft in geheugen tot opslaan. */
  importSessionId?: string;
  /** Na aanmaken recept automatisch aan deze lijst koppelen en naar lijst navigeren. */
  addToListId?: number;
  addToListName?: string;
};

export function RecipeForm({ recipeId, importSessionId, addToListId, addToListName }: Props) {
  const router = useRouter();
  const navigation = useNavigation();
  const theme = useAppTheme();
  const [loading, setLoading] = useState(!!(recipeId || importSessionId?.trim()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [baseServingsStr, setBaseServingsStr] = useState('4');
  const [prepStr, setPrepStr] = useState('');
  const [cookStr, setCookStr] = useState('');
  const [totalStr, setTotalStr] = useState('');
  const [category, setCategory] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [newCategoryInput, setNewCategoryInput] = useState('');
  const [dietVegetarian, setDietVegetarian] = useState(false);
  const [dietVegan, setDietVegan] = useState(false);
  const [dietKeto, setDietKeto] = useState(false);
  const [isFavorite, setIsFavorite] = useState(false);
  const [wantToTry, setWantToTry] = useState(false);
  const [notes, setNotes] = useState('');
  const [imageUri, setImageUri] = useState('');
  const [pickingCover, setPickingCover] = useState(false);
  const [tagsStr, setTagsStr] = useState('');
  const [customDiets, setCustomDiets] = useState<string[]>([]);
  const [customDietKeys, setCustomDietKeys] = useState<string[]>([]);
  const [tagsPickerOpen, setTagsPickerOpen] = useState(false);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [tagKeys, setTagKeys] = useState<string[]>([]);
  const [newTagInput, setNewTagInput] = useState('');

  const [groups, setGroups] = useState<DraftGroup[]>(emptyDraft().groups);
  const [sections, setSections] = useState<DraftSection[]>(emptyDraft().sections);
  /** JSON snapshot of last loaded / initial form; used for unsaved-changes detection. */
  const [baselineJson, setBaselineJson] = useState<string | null>(null);

  const applySavePayload = useCallback((p: RecipeSavePayload) => {
    setTitle(p.title);
    setDescription(p.description);
    setSourceUrl(p.sourceUrl);
    setBaseServingsStr(String(p.baseServings));
    setPrepStr(p.prepTimeMin != null ? String(p.prepTimeMin) : '');
    setCookStr(p.cookTimeMin != null ? String(p.cookTimeMin) : '');
    setTotalStr(p.totalTimeMin != null ? String(p.totalTimeMin) : '');
    setCategory(p.category);
    setDietVegetarian(p.dietVegetarian);
    setDietVegan(p.dietVegan);
    setDietKeto(p.dietKeto);
    setIsFavorite(p.isFavorite);
    setWantToTry(p.wantToTry);
    setNotes(p.notes);
    setImageUri(p.imageUri);
    const normalTags = p.tagNames.filter((t) => !t.toLowerCase().startsWith('diet:'));
    const dietTags = p.tagNames
      .filter((t) => t.toLowerCase().startsWith('diet:'))
      .map((t) => t.slice(5).trim().toLowerCase().replace(/\s+/g, ' '))
      .filter(Boolean);
    setTagsStr(normalTags.join(', '));
    setTagKeys(normalTags);
    setCustomDietKeys(dietTags);
    setGroups(
      p.ingredientGroups.length > 0
        ? p.ingredientGroups.map((g) => ({
            id: newId(),
            title: g.title,
            ingredients: g.ingredients.map((i) => ({
              id: newId(),
              name: i.name,
              amount: i.amount != null ? String(i.amount) : '',
              unit: i.unit ?? '',
            })),
          }))
        : emptyDraft().groups
    );
    setSections(
      p.stepSections.length > 0
        ? p.stepSections.map((s) => ({
            id: newId(),
            title: s.title,
            steps: s.steps.map((st) => {
              const ts = st.timerSeconds;
              const hasTimer = ts != null && ts > 0;
              return {
                id: newId(),
                description: st.description,
                timerMin: hasTimer ? timerSecondsToMinuteDraftStr(ts) : '',
                showTimerField: hasTimer,
              };
            }),
          }))
        : emptyDraft().sections
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [list, tags, recipeCats, managedCats] = await Promise.all([
          getCustomDiets(),
          listDistinctRecipeTags(),
          listDistinctRecipeCategories(),
          listManagedCategories(),
        ]);
        if (cancelled) return;
        setCustomDiets(list.map((d) => d.name));
        setCustomDietKeys((prev) => prev.filter((x) => list.some((d) => d.name === x)));
        setAllTags(tags);
        setTagKeys((prev) => prev.filter((t) => tags.includes(t)));
        setCategories(() => {
          const all = new Set<string>([...managedCats, ...recipeCats].filter(Boolean));
          return Array.from(all).sort((a, b) => a.localeCompare(b, 'nl'));
        });
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const cur = category.trim();
    if (!cur) return;
    setCategories((prev) => {
      if (prev.includes(cur)) return prev;
      return [...prev, cur].sort((a, b) => a.localeCompare(b, 'nl'));
    });
  }, [category]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (recipeId) {
        const r = await getFullRecipe(recipeId);
        if (cancelled) return;
        if (!r) {
          setError('Recept niet gevonden.');
          setLoading(false);
          return;
        }
        applySavePayload(fullRecipeToPayload(r));
        setError(null);
        setLoading(false);
        return;
      }

      const sid = importSessionId?.trim();
      if (sid) {
        const p = getImportSession(sid);
        if (cancelled) return;
        if (p) {
          applySavePayload(p);
          setError(null);
        }
        setLoading(false);
        return;
      }

      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [recipeId, importSessionId, applySavePayload]);

  // Snapshot form once loading finishes (initial state for dirty check). Intentionally only `loading`.
  useEffect(() => {
    if (loading) {
      setBaselineJson(null);
      return;
    }
    const vega = dietVegetarian || dietVegan;
    setBaselineJson(
      JSON.stringify(
        buildPayload(
          title,
          description,
          sourceUrl,
          baseServingsStr,
          prepStr,
          cookStr,
          totalStr,
          category,
          vega,
          dietVegan,
          dietKeto,
          isFavorite,
          wantToTry,
          notes,
          imageUri,
          tagKeys.join(', '),
          customDietKeys,
          groups,
          sections
        )
      )
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only reset baseline when loading completes
  }, [loading]);

  const applyNewCoverUri = useCallback((stored: string) => {
    setImageUri((prev) => {
      if (prev && prev !== stored && isAppManagedCoverUri(prev)) {
        void tryDeleteManagedCover(prev);
      }
      return stored;
    });
  }, []);

  const onPickCoverFromLibrary = useCallback(async () => {
    setError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        'Toegang nodig',
        'Geef toegang tot je fotobibliotheek om een receptfoto te kiezen.'
      );
      return;
    }
    setPickingCover(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.85,
      });
      if (result.canceled) return;
      const uri = result.assets[0]?.uri;
      if (!uri) return;
      const stored = await persistPickedRecipeCover(uri);
      applyNewCoverUri(stored);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Foto kon niet worden opgeslagen.');
    } finally {
      setPickingCover(false);
    }
  }, [applyNewCoverUri]);

  const onTakeCoverPhoto = useCallback(async () => {
    setError(null);
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Toegang nodig', 'Geef cameratoegang om een foto te maken.');
      return;
    }
    setPickingCover(true);
    try {
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.85,
      });
      if (result.canceled) return;
      const uri = result.assets[0]?.uri;
      if (!uri) return;
      const stored = await persistPickedRecipeCover(uri);
      applyNewCoverUri(stored);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Foto kon niet worden opgeslagen.');
    } finally {
      setPickingCover(false);
    }
  }, [applyNewCoverUri]);

  const buildCurrentPayload = useCallback((): RecipeSavePayload => {
    const vega = dietVegetarian || dietVegan;
    return buildPayload(
      title,
      description,
      sourceUrl,
      baseServingsStr,
      prepStr,
      cookStr,
      totalStr,
      category,
      vega,
      dietVegan,
      dietKeto,
      isFavorite,
      wantToTry,
      notes,
      imageUri,
      tagKeys.join(', '),
      customDietKeys,
      groups,
      sections
    );
  }, [
    title,
    description,
    sourceUrl,
    baseServingsStr,
    prepStr,
    cookStr,
    totalStr,
    category,
    dietVegetarian,
    dietVegan,
    dietKeto,
    isFavorite,
    wantToTry,
    notes,
    imageUri,
    customDietKeys,
    tagKeys,
    groups,
    sections,
  ]);

  const isDirty =
    !loading &&
    !saving &&
    baselineJson != null &&
    JSON.stringify(buildCurrentPayload()) !== baselineJson;

  const persistFromForm = useCallback(
    async (pendingRemove?: { action: NavigationAction }): Promise<void> => {
      const payload = buildCurrentPayload();
      if (recipeId) {
        await updateRecipe(recipeId, payload);
        if (pendingRemove) {
          navigation.dispatch(pendingRemove.action);
        } else {
          router.back();
        }
        return;
      }
      const id = await createRecipe(payload);
      const sid = importSessionId?.trim();
      if (sid) disposeImportSession(sid);
      if (addToListId != null && Number.isFinite(addToListId)) {
        await addRecipeToList(addToListId, id);
        router.replace(`/list/${addToListId}`);
      } else {
        router.replace(`/recipe/${id}`);
      }
    },
    [buildCurrentPayload, recipeId, importSessionId, addToListId, navigation, router]
  );

  usePreventRemove(isDirty, ({ data }) => {
    Alert.alert(
      'Niet-opgeslagen wijzigingen',
      'Wil je je wijzigingen opslaan voordat je de pagina verlaat?',
      [
        { text: 'Annuleren', style: 'cancel' },
        {
          text: 'Niet opslaan',
          style: 'destructive',
          onPress: () => navigation.dispatch(data.action),
        },
        {
          text: 'Opslaan',
          onPress: () => {
            void (async () => {
              setError(null);
              setSaving(true);
              try {
                await persistFromForm(data);
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Opslaan mislukt.');
              } finally {
                setSaving(false);
              }
            })();
          },
        },
      ]
    );
  });

  const onSave = useCallback(() => {
    setError(null);
    setSaving(true);
    void (async () => {
      try {
        await persistFromForm(undefined);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Opslaan mislukt.');
      } finally {
        setSaving(false);
      }
    })();
  }, [persistFromForm]);

  useLayoutEffect(() => {
    if (!recipeId) return;
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={onSave}
          disabled={saving}
          accessibilityRole="button"
          accessibilityLabel="Opslaan"
          style={({ pressed }) => [
            styles.headerSaveBtn,
            { opacity: saving ? 0.5 : pressed ? 0.6 : 1 },
          ]}
          hitSlop={10}
        >
          {saving ? (
            <ActivityIndicator size="small" color={theme.accent} />
          ) : (
            <Text style={[styles.headerSaveIcon, { color: theme.accent }]}>💾</Text>
          )}
        </Pressable>
      ),
    });
  }, [navigation, onSave, recipeId, saving, theme.accent]);

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background }]}>
        <ActivityIndicator size="large" color={theme.accent} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: theme.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="always"
        keyboardDismissMode="on-drag"
      >
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Modal
          visible={categoryPickerOpen}
          animationType="fade"
          transparent
          onRequestClose={() => setCategoryPickerOpen(false)}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Nieuwe categorie</Text>
              <Text style={styles.modalHint}>Bijv. “diner”, “weekend”, “bakken”.</Text>
              <View style={styles.modalRow}>
                <TextInput
                  style={[styles.input, styles.flex1, { marginBottom: 0 }]}
                  placeholder="Categorie…"
                  value={newCategoryInput}
                  onChangeText={setNewCategoryInput}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <Pressable
                  style={[styles.modalAddBtn, !newCategoryInput.trim() ? styles.modalAddBtnOff : null]}
                  onPress={() => {
                    const n = newCategoryInput.trim();
                    if (!n) return;
                    void (async () => {
                      try {
                        const next = await addManagedCategory(n);
                        setCategories((prev) => {
                          const cur = category.trim();
                          const all = new Set<string>([...prev, ...next, ...(cur ? [cur] : [])].filter(Boolean));
                          return Array.from(all).sort((a, b) => a.localeCompare(b, 'nl'));
                        });
                        setCategory(n.toLowerCase().trim().replace(/\s+/g, ' '));
                        setNewCategoryInput('');
                        setCategoryPickerOpen(false);
                      } catch {
                        /* ignore */
                      }
                    })();
                  }}
                  disabled={!newCategoryInput.trim()}
                >
                  <Text style={styles.modalAddBtnText}>+</Text>
                </Pressable>
              </View>
              <Pressable style={styles.modalCloseBtn} onPress={() => setCategoryPickerOpen(false)}>
                <Text style={styles.modalCloseBtnText}>Sluiten</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        <Modal visible={tagsPickerOpen} animationType="fade" transparent onRequestClose={() => setTagsPickerOpen(false)}>
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Tags kiezen</Text>
              <Text style={styles.modalHint}>Tik om aan/uit te zetten. Je kunt meerdere tags selecteren.</Text>

              <View style={styles.modalRow}>
                <TextInput
                  style={[styles.input, styles.flex1, { marginBottom: 0 }]}
                  placeholder="Nieuwe tag…"
                  value={newTagInput}
                  onChangeText={setNewTagInput}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <Pressable
                  style={[styles.modalAddBtn, !newTagInput.trim() ? styles.modalAddBtnOff : null]}
                  onPress={() => {
                    const n = newTagInput.trim().toLowerCase().replace(/\\s+/g, ' ');
                    if (!n) return;
                    setAllTags((prev) =>
                      prev.includes(n) ? prev : [...prev, n].sort((a, b) => a.localeCompare(b, 'nl'))
                    );
                    setTagKeys((prev) => (prev.includes(n) ? prev : [...prev, n]));
                    setNewTagInput('');
                  }}
                  disabled={!newTagInput.trim()}
                >
                  <Text style={styles.modalAddBtnText}>+</Text>
                </Pressable>
              </View>

              <FlatList
                data={allTags}
                numColumns={2}
                keyExtractor={(it) => it}
                columnWrapperStyle={styles.gridRow}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => {
                  const on = tagKeys.includes(item);
                  return (
                    <Pressable
                      style={[styles.gridCell, on ? styles.chipOn : null]}
                      onPress={() => {
                        setTagKeys((prev) => {
                          const s = new Set(prev);
                          if (s.has(item)) s.delete(item);
                          else s.add(item);
                          return Array.from(s);
                        });
                      }}
                    >
                      <Text style={[styles.gridCellText, on ? styles.chipTextOn : null]} numberOfLines={3}>
                        {item}
                      </Text>
                    </Pressable>
                  );
                }}
              />

              <Pressable style={styles.modalCloseBtn} onPress={() => setTagsPickerOpen(false)}>
                <Text style={styles.modalCloseBtnText}>Klaar</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        {addToListId != null && addToListName ? (
          <View style={styles.listBanner}>
            <Text style={styles.listBannerText}>
              Na opslaan wordt dit recept toegevoegd aan de lijst «{addToListName}».
            </Text>
          </View>
        ) : null}

        <Text style={styles.label}>Titel</Text>
        <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="Bijv. Pasta pesto" />

        <Text style={styles.label}>Beschrijving</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={description}
          onChangeText={setDescription}
          placeholder="Korte omschrijving"
          multiline
        />

        <Text style={styles.label}>Receptfoto (optioneel)</Text>
        {imageUri ? (
          <Image source={{ uri: imageUri }} style={styles.coverPreview} resizeMode="cover" />
        ) : (
          <View style={styles.coverPlaceholder}>
            <Text style={styles.coverPlaceholderText}>Nog geen foto</Text>
          </View>
        )}
        <View style={styles.coverActions}>
          <Pressable
            style={[
              styles.coverPickBtn,
              { backgroundColor: theme.accent },
              pickingCover && styles.coverPickBtnDisabled,
            ]}
            onPress={onPickCoverFromLibrary}
            disabled={pickingCover}
          >
            {pickingCover ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.coverPickBtnText}>Kies uit galerij</Text>
            )}
          </Pressable>
          {Platform.OS !== 'web' ? (
            <Pressable
              style={[
                styles.coverPickBtnOutline,
                { borderColor: theme.accent },
                pickingCover && styles.coverPickBtnDisabled,
              ]}
              onPress={onTakeCoverPhoto}
              disabled={pickingCover}
            >
              <Text style={[styles.coverPickBtnOutlineText, { color: theme.accent }]}>Maak foto</Text>
            </Pressable>
          ) : null}
          {imageUri ? (
            <Pressable style={styles.coverRemoveBtn} onPress={() => setImageUri('')} disabled={pickingCover}>
              <Text style={styles.coverRemoveBtnText}>Verwijderen</Text>
            </Pressable>
          ) : null}
        </View>

        <Text style={styles.label}>Porties (basis)</Text>
        <TextInput
          style={styles.input}
          value={baseServingsStr}
          onChangeText={setBaseServingsStr}
          keyboardType="number-pad"
          placeholder="4"
        />

        <View style={styles.row3}>
          <View style={styles.row3Item}>
            <Text style={styles.label}>Voorbereiding (min)</Text>
            <TextInput style={styles.input} value={prepStr} onChangeText={setPrepStr} keyboardType="number-pad" />
          </View>
          <View style={styles.row3Item}>
            <Text style={styles.label}>Koken (min)</Text>
            <TextInput style={styles.input} value={cookStr} onChangeText={setCookStr} keyboardType="number-pad" />
          </View>
          <View style={styles.row3Item}>
            <Text style={styles.label}>Totaal (min)</Text>
            <TextInput style={styles.input} value={totalStr} onChangeText={setTotalStr} keyboardType="number-pad" />
          </View>
        </View>

        <Text style={styles.label}>Categorie</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
          <View style={styles.chipRowNoWrap}>
            <Pressable
              style={[styles.chip, !category.trim() ? styles.chipOn : null]}
              onPress={() => setCategory('')}
            >
              <Text style={[styles.chipText, !category.trim() ? styles.chipTextOn : null]}>Geen</Text>
            </Pressable>
            {categories.map((c) => {
              const on = category.trim() === c;
              return (
                <Pressable
                  key={c}
                  style={[styles.chip, on ? styles.chipOn : null]}
                  onPress={() => setCategory((cur) => (cur.trim() === c ? '' : c))}
                >
                  <Text style={[styles.chipText, on ? styles.chipTextOn : null]} numberOfLines={1}>
                    {c}
                  </Text>
                </Pressable>
              );
            })}
            <Pressable style={[styles.chip, styles.chipAdd]} onPress={() => setCategoryPickerOpen(true)}>
              <Text style={[styles.chipText, styles.chipAddText]}>+ nieuw</Text>
            </Pressable>
          </View>
        </ScrollView>

        <Text style={styles.label}>Dieet</Text>
        <View style={styles.chipRow}>
          <Pressable
            style={[styles.chip, dietVegetarian ? styles.chipOn : null]}
            onPress={() => {
              setDietVegetarian((cur) => {
                const next = !cur;
                if (!next) setDietVegan(false);
                return next;
              });
            }}
          >
            <Text style={[styles.chipText, dietVegetarian ? styles.chipTextOn : null]}>Vega</Text>
          </Pressable>
          <Pressable
            style={[styles.chip, dietVegan ? styles.chipOn : null]}
            onPress={() => {
              setDietVegan((cur) => {
                const next = !cur;
                if (next) setDietVegetarian(true);
                return next;
              });
            }}
          >
            <Text style={[styles.chipText, dietVegan ? styles.chipTextOn : null]}>Vegan</Text>
          </Pressable>
          <Pressable style={[styles.chip, dietKeto ? styles.chipOn : null]} onPress={() => setDietKeto((v) => !v)}>
            <Text style={[styles.chipText, dietKeto ? styles.chipTextOn : null]}>Keto</Text>
          </Pressable>
          {customDiets.map((d) => {
            const on = customDietKeys.includes(d);
            return (
              <Pressable
                key={d}
                style={[styles.chip, on ? styles.chipOn : null]}
                onPress={() => {
                  setCustomDietKeys((prev) => {
                    const s = new Set(prev);
                    if (s.has(d)) s.delete(d);
                    else s.add(d);
                    return Array.from(s);
                  });
                }}
              >
                <Text style={[styles.chipText, on ? styles.chipTextOn : null]} numberOfLines={1}>
                  {d}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.label}>Status</Text>
        <View style={styles.chipRow}>
          <Pressable style={[styles.chip, isFavorite ? styles.chipOn : null]} onPress={() => setIsFavorite((v) => !v)}>
            <Text style={[styles.chipText, isFavorite ? styles.chipTextOn : null]}>Favoriet</Text>
          </Pressable>
          <Pressable style={[styles.chip, wantToTry ? styles.chipOn : null]} onPress={() => setWantToTry((v) => !v)}>
            <Text style={[styles.chipText, wantToTry ? styles.chipTextOn : null]}>Wil proberen</Text>
          </Pressable>
        </View>

        <Text style={styles.label}>Tags</Text>
        <View style={styles.chipRow}>
          {tagKeys.map((t) => (
            <Pressable
              key={t}
              style={[styles.chip, styles.chipOn]}
              onPress={() => setTagKeys((prev) => prev.filter((x) => x !== t))}
            >
              <Text style={[styles.chipText, styles.chipTextOn]} numberOfLines={1}>
                {t}
              </Text>
            </Pressable>
          ))}
          <Pressable style={styles.chip} onPress={() => setTagsPickerOpen(true)}>
            <Text style={styles.chipText}>+ tags</Text>
          </Pressable>
        </View>

        <Text style={styles.label}>Notities</Text>
        <TextInput style={[styles.input, styles.multiline]} value={notes} onChangeText={setNotes} multiline />

        <Text style={styles.label}>Bron-URL (optioneel)</Text>
        <TextInput style={styles.input} value={sourceUrl} onChangeText={setSourceUrl} placeholder="https://…" />

        <Text style={styles.sectionTitle}>Ingrediënten</Text>
        {groups.map((g, gi) => (
          <View key={g.id} style={styles.card}>
            <Text style={styles.label}>Groep (optioneel)</Text>
            <TextInput
              style={styles.input}
              value={g.title}
              onChangeText={(t) => {
                setGroups((prev) => {
                  const next = [...prev];
                  next[gi] = { ...next[gi], title: t };
                  return next;
                });
              }}
              placeholder="Bijv. voor de saus"
            />
            {g.ingredients.map((ing, ii) => (
              <View key={ing.id} style={styles.ingRow}>
                <TextInput
                  style={[styles.input, styles.ingName]}
                  value={ing.name}
                  onChangeText={(t) => {
                    setGroups((prev) => {
                      const next = [...prev];
                      const ings = [...next[gi].ingredients];
                      ings[ii] = { ...ings[ii], name: t };
                      next[gi] = { ...next[gi], ingredients: ings };
                      return next;
                    });
                  }}
                  placeholder="Naam"
                />
                <TextInput
                  style={[styles.input, styles.ingAmt]}
                  value={ing.amount}
                  onChangeText={(t) => {
                    setGroups((prev) => {
                      const next = [...prev];
                      const ings = [...next[gi].ingredients];
                      ings[ii] = { ...ings[ii], amount: t };
                      next[gi] = { ...next[gi], ingredients: ings };
                      return next;
                    });
                  }}
                  placeholder="Hvh"
                  keyboardType="decimal-pad"
                />
                <TextInput
                  style={[styles.input, styles.ingUnit]}
                  value={ing.unit}
                  onChangeText={(t) => {
                    setGroups((prev) => {
                      const next = [...prev];
                      const ings = [...next[gi].ingredients];
                      ings[ii] = { ...ings[ii], unit: t };
                      next[gi] = { ...next[gi], ingredients: ings };
                      return next;
                    });
                  }}
                  placeholder="eenheid"
                />
              </View>
            ))}
            <Pressable
              style={styles.smallBtn}
              hitSlop={12}
              onPress={() => {
                setGroups((prev) => {
                  const next = [...prev];
                  next[gi] = {
                    ...next[gi],
                    ingredients: [
                      ...next[gi].ingredients,
                      { id: newId(), name: '', amount: '', unit: '' },
                    ],
                  };
                  return next;
                });
              }}
            >
              <Text style={styles.smallBtnText}>+ Ingrediënt</Text>
            </Pressable>
          </View>
        ))}
        <Pressable
          style={styles.secondaryBtn}
          hitSlop={12}
          onPress={() =>
            setGroups((prev) => [
              ...prev,
              {
                id: newId(),
                title: '',
                ingredients: [{ id: newId(), name: '', amount: '', unit: '' }],
              },
            ])
          }
        >
          <Text style={[styles.secondaryBtnText, { color: theme.accent }]}>+ Ingrediëntgroep</Text>
        </Pressable>

        <Text style={styles.sectionTitle}>Bereiding</Text>
        {sections.map((s, si) => (
          <View key={s.id} style={styles.card}>
            <Text style={styles.label}>Sectie (optioneel)</Text>
            <TextInput
              style={styles.input}
              value={s.title}
              onChangeText={(t) => {
                setSections((prev) => {
                  const next = [...prev];
                  next[si] = { ...next[si], title: t };
                  return next;
                });
              }}
              placeholder="Bijv. het deeg"
            />
            {s.steps.map((st, ti) => (
              <View key={st.id} style={styles.stepBlock}>
                <Text style={styles.label}>Stap {ti + 1}</Text>
                <View style={styles.stepDescRow}>
                  <TextInput
                    style={[styles.input, styles.multiline, styles.stepDescInput]}
                    value={st.description}
                    onChangeText={(t) => {
                      setSections((prev) => {
                        const next = [...prev];
                        const steps = [...next[si].steps];
                        steps[ti] = { ...steps[ti], description: t };
                        next[si] = { ...next[si], steps };
                        return next;
                      });
                    }}
                    placeholder="Wat doe je?"
                    multiline
                  />
                  <Pressable
                    style={[
                      styles.timerIconBtn,
                      st.showTimerField && styles.timerIconBtnOpen,
                      stepHasTimerMinutes(st) && { borderColor: theme.accent },
                    ]}
                    onPress={() => {
                      setSections((prev) => {
                        const next = [...prev];
                        const steps = [...next[si].steps];
                        const cur = steps[ti];
                        steps[ti] = { ...cur, showTimerField: !cur.showTimerField };
                        next[si] = { ...next[si], steps };
                        return next;
                      });
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={
                      st.showTimerField ? 'Timer-veld verbergen' : 'Timer instellen'
                    }
                    accessibilityState={{ expanded: st.showTimerField }}
                    hitSlop={8}
                  >
                    <Text style={styles.timerIconText}>⏲</Text>
                  </Pressable>
                </View>
                {st.showTimerField ? (
                  <>
                    <Text style={styles.label}>Timer (minuten, optioneel)</Text>
                    <TextInput
                      style={styles.input}
                      value={st.timerMin}
                      onChangeText={(t) => {
                        setSections((prev) => {
                          const next = [...prev];
                          const steps = [...next[si].steps];
                          steps[ti] = { ...steps[ti], timerMin: t };
                          next[si] = { ...next[si], steps };
                          return next;
                        });
                      }}
                      keyboardType="decimal-pad"
                      placeholder="Geen"
                    />
                  </>
                ) : null}
              </View>
            ))}
            <Pressable
              style={styles.smallBtn}
              hitSlop={12}
              onPress={() => {
                setSections((prev) => {
                  const next = [...prev];
                  next[si] = {
                    ...next[si],
                    steps: [
                      ...next[si].steps,
                      { id: newId(), description: '', timerMin: '', showTimerField: false },
                    ],
                  };
                  return next;
                });
              }}
            >
              <Text style={styles.smallBtnText}>+ Stap</Text>
            </Pressable>
          </View>
        ))}
        <Pressable
          style={styles.secondaryBtn}
          hitSlop={12}
          onPress={() =>
            setSections((prev) => [
              ...prev,
              {
                id: newId(),
                title: '',
                steps: [{ id: newId(), description: '', timerMin: '', showTimerField: false }],
              },
            ])
          }
        >
          <Text style={[styles.secondaryBtnText, { color: theme.accent }]}>+ Stap-sectie</Text>
        </Pressable>

        <Pressable
          style={[styles.saveBtn, { backgroundColor: theme.accent }, saving && styles.saveBtnDisabled]}
          onPress={onSave}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.saveBtnText}>{recipeId ? 'Wijzigingen opslaan' : 'Recept opslaan'}</Text>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// Tags picker modal (grid + add new)

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { padding: 16, paddingBottom: 40 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  headerSaveBtn: { paddingHorizontal: 10, paddingVertical: 6 },
  headerSaveIcon: { fontSize: 18, fontWeight: '800' },
  label: { fontSize: 13, fontWeight: '600', color: '#444', marginBottom: 4, marginTop: 8 },
  switchLabel: { fontSize: 13, fontWeight: '600', color: '#444' },
  flex1: { flex: 1, minWidth: 180 },
  chipScroll: { marginTop: 4, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: '#e2ddd5',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    backgroundColor: '#fff',
  },
  multiline: { minHeight: 72, textAlignVertical: 'top' },
  stepDescRow: { flexDirection: 'row', alignItems: 'stretch', gap: 8 },
  stepDescInput: { flex: 1, minWidth: 0 },
  timerIconBtn: {
    width: 44,
    minHeight: 72,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2ddd5',
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  timerIconBtnOpen: { borderColor: '#2a6cb6', backgroundColor: '#f0f6fc' },
  timerIconText: { fontSize: 22, lineHeight: 26, textAlign: 'center' },
  row3: { flexDirection: 'row', gap: 8 },
  row3Item: { flex: 1 },
  // removed: switchRow
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4, marginBottom: 6 },
  chipRowNoWrap: { flexDirection: 'row', flexWrap: 'nowrap', gap: 8, paddingVertical: 2 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#e2ddd5',
    backgroundColor: '#fff',
    maxWidth: '100%',
  },
  chipOn: { borderColor: '#2a6cb6', backgroundColor: '#eef4fb' },
  chipText: { fontSize: 13, fontWeight: '700', color: '#444' },
  chipTextOn: { color: '#1b4b7a' },
  chipAdd: { borderStyle: 'dashed', borderColor: '#c9c2b8' },
  chipAddText: { fontWeight: '800' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    maxHeight: '88%',
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#1a1a1a', marginBottom: 6 },
  modalHint: { fontSize: 13, color: '#666', marginBottom: 12, lineHeight: 18 },
  modalRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  modalAddBtn: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#c05e2f',
  },
  modalAddBtnOff: { opacity: 0.5 },
  modalAddBtnText: { color: '#fff', fontWeight: '900', fontSize: 20, marginTop: -1 },
  gridRow: { gap: 8, marginBottom: 8 },
  gridCell: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2ddd5',
    backgroundColor: '#faf9f7',
    marginHorizontal: 4,
    minHeight: 48,
    justifyContent: 'center',
  },
  gridCellText: { fontSize: 14, color: '#333', fontWeight: '700', textAlign: 'center' },
  modalCloseBtn: { marginTop: 10, alignSelf: 'center', paddingVertical: 10, paddingHorizontal: 20 },
  modalCloseBtnText: { fontSize: 16, color: '#666', fontWeight: '700' },
  sectionTitle: { fontSize: 18, fontWeight: '700', marginTop: 20, marginBottom: 8, color: '#1a1a1a' },
  card: {
    borderWidth: 1,
    borderColor: '#e2ddd5',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    backgroundColor: '#fff',
  },
  ingRow: { flexDirection: 'row', gap: 8, marginBottom: 8, alignItems: 'center' },
  ingName: { flex: 2 },
  ingAmt: { flex: 1 },
  ingUnit: { flex: 1 },
  stepBlock: { marginBottom: 12 },
  smallBtn: {
    alignSelf: 'flex-start',
    marginTop: 4,
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  smallBtnText: { color: '#2a6cb6', fontWeight: '600', fontSize: 16 },
  secondaryBtn: {
    alignSelf: 'flex-start',
    marginBottom: 16,
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  secondaryBtnText: { fontWeight: '600', fontSize: 16 },
  saveBtn: {
    paddingVertical: 16,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 24,
  },
  saveBtnDisabled: { opacity: 0.7 },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  error: { color: '#b00020', marginBottom: 12, fontSize: 15 },
  listBanner: {
    backgroundColor: '#eef4fb',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#c5d6eb',
    padding: 12,
    marginBottom: 8,
  },
  listBannerText: { fontSize: 14, color: '#2a4a7a', lineHeight: 20 },
  coverPreview: {
    width: '100%',
    height: 200,
    borderRadius: 10,
    backgroundColor: '#e8e4dc',
    marginTop: 4,
  },
  coverPlaceholder: {
    width: '100%',
    height: 120,
    borderRadius: 10,
    backgroundColor: '#ece8e2',
    borderWidth: 1,
    borderColor: '#e2ddd5',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 4,
  },
  coverPlaceholderText: { fontSize: 14, color: '#888' },
  coverActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 10,
    marginBottom: 4,
  },
  coverPickBtn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    minWidth: 140,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverPickBtnDisabled: { opacity: 0.65 },
  coverPickBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  coverPickBtnOutline: {
    borderWidth: 1.5,
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: 10,
    minWidth: 120,
    alignItems: 'center',
  },
  coverPickBtnOutlineText: { fontWeight: '700', fontSize: 15 },
  coverRemoveBtn: { paddingVertical: 12, paddingHorizontal: 8, justifyContent: 'center' },
  coverRemoveBtnText: { color: '#b00020', fontWeight: '600', fontSize: 15 },
});
