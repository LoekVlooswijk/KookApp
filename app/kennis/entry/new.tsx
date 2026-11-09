import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppTheme } from '../../../components/ThemeContext';
import { IconClose, IconSearch, IconTag } from '../../../components/knowledge/icons';
import { KennisColors, KennisRadii } from '../../../components/knowledge/tokens';
import { searchRecipes, type RecipeBrowseFilters } from '../../../lib/recipesRepo';
import {
  listKnowledgeTags,
  saveKnowledgeEntry,
  upsertKnowledgeTagByName,
  type KnowledgeTagBare,
} from '../../../lib/knowledgeRepo';

type RecipePick = { id: number; title: string };

function inputToNull(s: string): string | null {
  const t = s.trim();
  return t ? t : null;
}

export default function KnowledgeEntryNewScreen() {
  const theme = useAppTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { tagId } = useLocalSearchParams<{ tagId?: string }>();
  const preTagId = tagId ? Number.parseInt(tagId, 10) : null;

  const [title, setTitle] = useState('');
  const [ratio, setRatio] = useState('');
  const [content, setContent] = useState('');
  const [tags, setTags] = useState<KnowledgeTagBare[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([]);
  const [tagQuery, setTagQuery] = useState('');

  const [recipeQuery, setRecipeQuery] = useState('');
  const [recipeResults, setRecipeResults] = useState<RecipePick[]>([]);
  const [sourceRecipe, setSourceRecipe] = useState<RecipePick | null>(null);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        const t = await listKnowledgeTags();
        setTags(t);
        if (preTagId && t.some((x) => x.id === preTagId)) {
          setSelectedTagIds((prev) => (prev.includes(preTagId) ? prev : [preTagId, ...prev]));
        }
      })();
    }, [preTagId])
  );

  const canSave = title.trim().length > 0;
  const keyboardOffset = Math.round(insets.top * 0.67) + 56;

  const selectedTags = useMemo(() => {
    const map = new Map(tags.map((t) => [t.id, t]));
    return selectedTagIds.map((id) => map.get(id)).filter(Boolean) as KnowledgeTagBare[];
  }, [selectedTagIds, tags]);

  const tagSuggestions = useMemo(() => {
    const q = tagQuery.trim().toLowerCase();
    if (!q) return [];
    return tags
      .filter((t) => t.name.toLowerCase().includes(q) && !selectedTagIds.includes(t.id))
      .slice(0, 10);
  }, [selectedTagIds, tagQuery, tags]);

  const sheetQuickAdds = useMemo(() => tags.filter((t) => t.isSheet), [tags]);

  const searchRecipe = useCallback((q: string) => {
    setRecipeQuery(q);
    const trimmed = q.trim();
    if (!trimmed) {
      setRecipeResults([]);
      return;
    }
    void (async () => {
      const filters: RecipeBrowseFilters = {
        query: trimmed,
        category: null,
        tagNames: [],
        dietKeys: [],
        customDietNames: [],
        favoritesOnly: false,
        wantToTryOnly: false,
        maxTotalTimeMin: null,
        inListId: null,
      };
      const rows = await searchRecipes(filters);
      setRecipeResults(rows.slice(0, 10).map((r) => ({ id: r.id, title: r.title })));
    })();
  }, []);

  const save = useCallback(() => {
    if (!canSave) return;
    void (async () => {
      const id = await saveKnowledgeEntry({
        title,
        ratio: inputToNull(ratio),
        content: inputToNull(content),
        sourceRecipeId: sourceRecipe?.id ?? null,
        tagIds: selectedTagIds,
      });
      router.replace(`/kennis/entry/${id}`);
    })();
  }, [canSave, content, ratio, router, selectedTagIds, sourceRecipe?.id, title]);

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: theme.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? keyboardOffset : 0}
    >
      <View
        style={[
          styles.headerWrap,
          {
            paddingTop: styles.headerWrap.paddingTop + Math.round(insets.top * 0.67),
            backgroundColor: theme.background,
          },
        ]}
      >
        <Pressable
          onPress={() => router.back()}
          style={styles.headerBtn}
          accessibilityRole="button"
          accessibilityLabel="Annuleren"
        >
          <Text style={[styles.headerBtnText, { color: theme.accent }]}>Annuleer</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Nieuwe entry</Text>
        <Pressable
          onPress={save}
          style={[styles.saveBtn, { backgroundColor: theme.accent }, !canSave && styles.saveBtnOff]}
          disabled={!canSave}
          accessibilityRole="button"
          accessibilityLabel="Opslaan"
        >
          <Text style={styles.saveBtnText}>Opslaan</Text>
        </Pressable>
      </View>

      <FlatList
        data={[{ key: 'form' }]}
        keyExtractor={(x) => x.key}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingBottom: 24 + insets.bottom + 120 }}
        renderItem={() => (
          <View style={styles.form}>
            <Text style={styles.label}>Titel *</Text>
            <TextInput
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              placeholder="Bijv. Mexicaans — taco's"
              placeholderTextColor={KennisColors.inkMute}
            />

            <Text style={styles.label}>Ratio (optioneel)</Text>
            <TextInput
              style={styles.input}
              value={ratio}
              onChangeText={setRatio}
              placeholder="Bijv. 3:1 olie:zuur"
              placeholderTextColor={KennisColors.inkMute}
            />

            <Text style={styles.label}>Inhoud</Text>
            <TextInput
              style={[styles.input, styles.multiline]}
              value={content}
              onChangeText={setContent}
              placeholder="Schrijf je kennis hier…"
              placeholderTextColor={KennisColors.inkMute}
              multiline
            />

            <Text style={styles.label}>Tags</Text>
            <View style={styles.tagRow}>
              {selectedTags.map((t) => (
                <Pressable
                  key={t.id}
                  style={[styles.tagChip, { backgroundColor: theme.background }]}
                  onPress={() => setSelectedTagIds((prev) => prev.filter((x) => x !== t.id))}
                >
                  <Text style={styles.tagChipText}>{t.name}</Text>
                  <IconClose size={12} stroke={2} color={KennisColors.inkSoft} />
                </Pressable>
              ))}
            </View>

            <View style={styles.tagAddRow}>
              <IconTag size={14} stroke={2} color={KennisColors.inkSoft} />
              <TextInput
                style={styles.tagAddInput}
                value={tagQuery}
                onChangeText={setTagQuery}
                placeholder="Voeg tag toe…"
                placeholderTextColor={KennisColors.inkMute}
                onSubmitEditing={() => {
                  const q = tagQuery.trim();
                  if (!q) return;
                  void (async () => {
                    const t = await upsertKnowledgeTagByName(q);
                    if (!t) return;
                    setTags((prev) => (prev.some((x) => x.id === t.id) ? prev : [t, ...prev]));
                    setSelectedTagIds((prev) => (prev.includes(t.id) ? prev : [...prev, t.id]));
                    setTagQuery('');
                  })();
                }}
              />
            </View>

            {sheetQuickAdds.length > 0 ? (
              <View style={styles.sheetQuickRow}>
                {sheetQuickAdds.map((t) => {
                  const on = selectedTagIds.includes(t.id);
                  return (
                    <Pressable
                      key={`sheet-quick-${t.id}`}
                      style={[
                        styles.sheetQuickChip,
                        on
                          ? { backgroundColor: theme.accentSoft, borderColor: theme.accentSoft }
                          : null,
                      ]}
                      onPress={() =>
                        setSelectedTagIds((prev) => (prev.includes(t.id) ? prev : [...prev, t.id]))
                      }
                    >
                      <Text
                        style={[styles.sheetQuickChipText, on ? { color: theme.accent } : null]}
                        numberOfLines={1}
                      >
                        {t.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            {tagSuggestions.length > 0 ? (
              <View style={styles.suggestions}>
                {tagSuggestions.map((t) => (
                  <Pressable
                    key={t.id}
                    style={styles.suggestionRow}
                    onPress={() => {
                      setSelectedTagIds((prev) => (prev.includes(t.id) ? prev : [...prev, t.id]));
                      setTagQuery('');
                    }}
                  >
                    <Text style={styles.suggestionText}>{t.name}</Text>
                    {t.isSheet ? <Text style={styles.suggestionMeta}>sheet</Text> : null}
                  </Pressable>
                ))}
              </View>
            ) : null}

            <Text style={styles.label}>Geleerd bij (optioneel)</Text>
            {sourceRecipe ? (
              <View style={styles.recipePickedRow}>
                <Text style={[styles.recipePickedText, { color: theme.accent }]} numberOfLines={1}>
                  {sourceRecipe.title}
                </Text>
                <Pressable
                  onPress={() => setSourceRecipe(null)}
                  accessibilityRole="button"
                  accessibilityLabel="Recept verwijderen"
                >
                  <IconClose size={16} stroke={2} color={KennisColors.inkSoft} />
                </Pressable>
              </View>
            ) : (
              <View style={styles.recipeSearchPill}>
                <IconSearch size={18} stroke={1.8} color={KennisColors.inkMute} />
                <TextInput
                  style={styles.recipeSearchInput}
                  value={recipeQuery}
                  onChangeText={searchRecipe}
                  placeholder="Zoek recept… (meerdere woorden: spatie of komma)"
                  placeholderTextColor={KennisColors.inkMute}
                />
              </View>
            )}

            {sourceRecipe == null && recipeResults.length > 0 ? (
              <View style={styles.recipeResults}>
                {recipeResults.map((r) => (
                  <Pressable
                    key={r.id}
                    style={styles.recipeResultRow}
                    onPress={() => {
                      setSourceRecipe(r);
                      setRecipeQuery('');
                      setRecipeResults([]);
                    }}
                  >
                    <Text style={styles.recipeResultText} numberOfLines={2}>
                      {r.title}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
        )}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  headerWrap: {
    paddingTop: 8,
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: KennisColors.borderSoft,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerBtn: { paddingVertical: 8, paddingHorizontal: 6 },
  headerBtnText: { fontWeight: '600' },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '700',
    color: KennisColors.ink,
  },
  saveBtn: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 999 },
  saveBtnOff: { opacity: 0.5 },
  saveBtnText: { color: '#fff', fontWeight: '700' },

  form: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 28, gap: 10 },
  label: { marginTop: 8, fontSize: 12, fontWeight: '700', color: KennisColors.inkSoft },
  input: {
    height: 42,
    paddingHorizontal: 12,
    backgroundColor: KennisColors.card,
    borderWidth: 1,
    borderColor: KennisColors.border,
    borderRadius: KennisRadii.card,
    color: KennisColors.ink,
    fontSize: 14.5,
  },
  multiline: { height: 120, paddingTop: 10, paddingBottom: 10, textAlignVertical: 'top' },

  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: KennisColors.border,
  },
  tagChipText: { fontSize: 12, fontWeight: '600', color: KennisColors.inkSoft },

  tagAddRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 42,
    paddingHorizontal: 12,
    backgroundColor: KennisColors.card,
    borderWidth: 1,
    borderColor: KennisColors.border,
    borderRadius: KennisRadii.card,
  },
  tagAddInput: { flex: 1, minWidth: 0, fontSize: 14.5, color: KennisColors.ink },
  sheetQuickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  sheetQuickChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: KennisColors.border,
    backgroundColor: KennisColors.card,
  },
  sheetQuickChipText: { fontSize: 12, fontWeight: '700', color: KennisColors.inkSoft },
  suggestions: {
    backgroundColor: KennisColors.card,
    borderWidth: 1,
    borderColor: KennisColors.border,
    borderRadius: KennisRadii.card,
    overflow: 'hidden',
  },
  suggestionRow: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: KennisColors.borderSoft,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  suggestionText: { flex: 1, fontSize: 14, fontWeight: '600', color: KennisColors.ink },
  suggestionMeta: { fontSize: 11, color: KennisColors.inkMute, fontWeight: '700' },

  recipeSearchPill: {
    height: 42,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: KennisColors.card,
    borderWidth: 1,
    borderColor: KennisColors.border,
    borderRadius: KennisRadii.card,
  },
  recipeSearchInput: { flex: 1, minWidth: 0, fontSize: 14.5, color: KennisColors.ink },
  recipeResults: {
    backgroundColor: KennisColors.card,
    borderWidth: 1,
    borderColor: KennisColors.border,
    borderRadius: KennisRadii.card,
    overflow: 'hidden',
  },
  recipeResultRow: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: KennisColors.borderSoft,
  },
  recipeResultText: { fontSize: 14, color: KennisColors.ink, fontWeight: '600' },
  recipePickedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: KennisColors.card,
    borderWidth: 1,
    borderColor: KennisColors.border,
    borderRadius: KennisRadii.card,
  },
  recipePickedText: { flex: 1, minWidth: 0, fontSize: 14, fontWeight: '600' },
});
