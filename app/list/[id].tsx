import {
  useFocusEffect,
  useLocalSearchParams,
  useNavigation,
  usePreventRemove,
  useRouter,
} from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useConfirmDialog } from '../../components/ConfirmDialog';
import { RecipeListThumb } from '../../components/RecipeListThumb';
import { useAppTheme } from '../../components/ThemeContext';
import {
  addRecipesToList,
  deleteList,
  getListMeta,
  getRecipesInList,
  listRecipesNotInList,
  removeRecipeFromList,
  type RecipeListMeta,
} from '../../lib/listsRepo';
import type { RecipeListItem } from '../../lib/types';

export default function ListDetailScreen() {
  const theme = useAppTheme();
  const { confirm, ConfirmDialog } = useConfirmDialog();
  const { id: idParam } = useLocalSearchParams<{ id: string }>();
  const listId = Number.parseInt(idParam ?? '', 10);
  const navigation = useNavigation();
  const router = useRouter();

  const [meta, setMeta] = useState<RecipeListMeta | null>(null);
  const [items, setItems] = useState<RecipeListItem[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [candidates, setCandidates] = useState<RecipeListItem[]>([]);
  const [filter, setFilter] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [adding, setAdding] = useState(false);

  const refresh = useCallback(() => {
    if (!Number.isFinite(listId)) return;
    void (async () => {
      const [m, rows] = await Promise.all([getListMeta(listId), getRecipesInList(listId)]);
      setMeta(m);
      setItems(rows);
    })();
  }, [listId]);

  useEffect(() => {
    refresh();
  }, [listId, refresh]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  useLayoutEffect(() => {
    if (meta?.name) {
      navigation.setOptions({ title: meta.name });
    }
  }, [meta?.name, navigation]);

  const openAdd = useCallback(() => {
    if (!Number.isFinite(listId)) return;
    void (async () => {
      setCandidates(await listRecipesNotInList(listId));
      setFilter('');
      setSelectedIds(new Set());
      setAddOpen(true);
    })();
  }, [listId]);

  const filteredCandidates = candidates.filter((r) => {
    const q = filter.trim().toLowerCase();
    if (!q) return true;
    return (
      r.title.toLowerCase().includes(q) || (r.category && r.category.toLowerCase().includes(q))
    );
  });

  const closeAdd = useCallback(() => {
    setSelectedIds(new Set());
    setAddOpen(false);
  }, []);

  usePreventRemove(addOpen, () => {
    closeAdd();
  });

  const toggleSelected = useCallback((recipeId: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(recipeId)) next.delete(recipeId);
      else next.add(recipeId);
      return next;
    });
  }, []);

  const selectedCount = selectedIds.size;

  const selectAllFiltered = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const r of filteredCandidates) next.add(r.id);
      return next;
    });
  }, [filteredCandidates]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const confirmAddSelected = useCallback(() => {
    if (!Number.isFinite(listId)) return;
    if (selectedIds.size === 0) return;
    setAdding(true);
    void (async () => {
      try {
        await addRecipesToList(listId, Array.from(selectedIds));
        closeAdd();
        refresh();
      } finally {
        setAdding(false);
      }
    })();
  }, [closeAdd, listId, refresh, selectedIds]);

  const onDeleteList = useCallback(() => {
    if (!Number.isFinite(listId)) return;
    void (async () => {
      const ok = await confirm({
        title: 'Lijst verwijderen',
        message: 'Alle koppelingen met recepten gaan verloren. Doorgaan?',
        confirmText: 'Verwijderen',
        cancelText: 'Annuleren',
        destructive: true,
      });
      if (!ok) return;
      await deleteList(listId);
      router.back();
    })();
  }, [confirm, listId, router]);

  if (!Number.isFinite(listId)) {
    return (
      <View style={styles.center}>
        <Text>Ongeldige lijst.</Text>
      </View>
    );
  }

  if (!meta) {
    return (
      <View style={styles.center}>
        <Text>Lijst niet gevonden.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.flex, { backgroundColor: theme.background }]}>
      <ConfirmDialog />
      {meta.description ? <Text style={styles.desc}>{meta.description}</Text> : null}

      <View style={styles.toolbar}>
        <Pressable style={[styles.primaryBtn, { backgroundColor: theme.accent }]} onPress={openAdd}>
          <Text style={styles.primaryBtnText}>+ Recept toevoegen</Text>
        </Pressable>
        <Pressable onPress={onDeleteList}>
          <Text style={styles.danger}>Lijst verwijderen</Text>
        </Pressable>
      </View>

      {items.length > 0 ? (
        <Text style={styles.listHint}>
          Lang indrukken op een recept om het uit deze lijst te halen.
        </Text>
      ) : null}

      <FlatList
        data={items}
        keyExtractor={(r) => String(r.id)}
        contentContainerStyle={items.length === 0 ? styles.emptyList : undefined}
        ListEmptyComponent={<Text style={styles.empty}>Nog geen recepten in deze lijst.</Text>}
        renderItem={({ item }) => (
          <Pressable
            style={styles.card}
            onPress={() => router.push(`/recipe/${item.id}`)}
            onLongPress={() => {
              void (async () => {
                const ok = await confirm({
                  title: 'Uit lijst halen?',
                  message: item.title,
                  confirmText: 'Verwijderen',
                  cancelText: 'Annuleren',
                  destructive: true,
                });
                if (!ok) return;
                await removeRecipeFromList(listId, item.id);
                refresh();
              })();
            }}
          >
            <View style={styles.cardRow}>
              <RecipeListThumb uri={item.imageUri} size={52} />
              <View style={styles.cardTextCol}>
                <Text style={styles.cardTitle} numberOfLines={2}>
                  {item.title}
                </Text>
                {item.category ? <Text style={styles.cardSub}>{item.category}</Text> : null}
              </View>
            </View>
          </Pressable>
        )}
      />

      <Modal visible={addOpen} animationType="slide" transparent onRequestClose={closeAdd}>
        <Pressable style={styles.modalBackdrop} onPress={closeAdd}>
          <Pressable
            style={[styles.modalCard, { backgroundColor: theme.background }]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={styles.modalTitle}>Recept toevoegen</Text>
            <Pressable
              style={[styles.modalNewRecipe, { backgroundColor: theme.accent }]}
              onPress={() => {
                closeAdd();
                router.push(`/recipe/new?listId=${listId}`);
              }}
            >
              <Text style={styles.modalNewRecipeText}>+ Nieuw recept maken</Text>
              <Text style={styles.modalNewRecipeSub}>
                Wordt na opslaan aan deze lijst toegevoegd
              </Text>
            </Pressable>
            <TextInput
              style={styles.input}
              placeholder="Zoeken bestaand recept…"
              value={filter}
              onChangeText={setFilter}
            />
            <View style={styles.bulkToolbar}>
              <Text style={styles.bulkHint}>
                {selectedCount === 0
                  ? 'Selecteer één of meer recepten.'
                  : `${selectedCount} geselecteerd`}
              </Text>
              <View style={styles.bulkActions}>
                <Pressable
                  style={[styles.bulkBtn, adding ? styles.bulkBtnDisabled : null]}
                  disabled={adding}
                  onPress={selectAllFiltered}
                >
                  <Text style={styles.bulkBtnText}>Alles</Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.bulkBtn,
                    selectedCount === 0 || adding ? styles.bulkBtnDisabled : null,
                  ]}
                  disabled={selectedCount === 0 || adding}
                  onPress={clearSelection}
                >
                  <Text style={styles.bulkBtnText}>Leeg</Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.bulkPrimaryBtn,
                    { backgroundColor: theme.accent },
                    selectedCount === 0 || adding ? styles.bulkBtnDisabled : null,
                  ]}
                  disabled={selectedCount === 0 || adding}
                  onPress={confirmAddSelected}
                >
                  <Text style={styles.bulkPrimaryBtnText}>
                    {adding ? 'Toevoegen…' : `Voeg toe (${selectedCount})`}
                  </Text>
                </Pressable>
              </View>
            </View>
            <FlatList
              data={filteredCandidates}
              keyExtractor={(r) => String(r.id)}
              style={styles.modalList}
              ListEmptyComponent={
                <Text style={styles.muted}>
                  Geen andere recepten om toe te voegen. Gebruik «Nieuw recept maken» hierboven.
                </Text>
              }
              renderItem={({ item }) => (
                <Pressable
                  style={styles.modalRow}
                  onPress={() => {
                    toggleSelected(item.id);
                  }}
                >
                  <View style={styles.modalRowInner}>
                    <View
                      style={[
                        styles.checkbox,
                        selectedIds.has(item.id) ? { borderColor: theme.accent } : null,
                      ]}
                    >
                      {selectedIds.has(item.id) ? (
                        <Text style={[styles.checkboxTick, { color: theme.accent }]}>✓</Text>
                      ) : null}
                    </View>
                    <RecipeListThumb uri={item.imageUri} size={44} />
                    <View style={styles.modalRowTextCol}>
                      <Text style={styles.modalRowText} numberOfLines={2}>
                        {item.title}
                      </Text>
                      {item.category ? (
                        <Text style={styles.modalRowCat} numberOfLines={1}>
                          {item.category}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                </Pressable>
              )}
            />
            <Pressable style={styles.modalClose} onPress={closeAdd}>
              <Text style={styles.modalCloseText}>Sluiten</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  desc: { paddingHorizontal: 16, paddingTop: 12, fontSize: 15, color: '#555', lineHeight: 22 },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  primaryBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
  },
  primaryBtnText: { color: '#fff', fontWeight: '700' },
  danger: { color: '#b00020', fontWeight: '600' },
  emptyList: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  empty: { textAlign: 'center', color: '#666' },
  card: {
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 14,
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2ddd5',
  },
  cardRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  cardTextCol: { flex: 1, minWidth: 0 },
  cardTitle: { fontSize: 17, fontWeight: '600' },
  cardSub: { fontSize: 14, color: '#666', marginTop: 4 },
  listHint: {
    fontSize: 12,
    color: '#888',
    paddingHorizontal: 16,
    paddingBottom: 8,
    lineHeight: 17,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    maxHeight: '80%',
  },
  modalTitle: { fontSize: 18, fontWeight: '700', marginBottom: 12 },
  modalNewRecipe: {
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 14,
  },
  modalNewRecipeText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  modalNewRecipeSub: { color: 'rgba(255,255,255,0.88)', fontSize: 12, marginTop: 4 },
  input: {
    borderWidth: 1,
    borderColor: '#e2ddd5',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    backgroundColor: '#fff',
  },
  bulkToolbar: {
    marginBottom: 10,
    gap: 10,
  },
  bulkHint: { color: '#666', fontSize: 13 },
  bulkActions: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  bulkBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2ddd5',
    backgroundColor: '#fff',
  },
  bulkBtnDisabled: { opacity: 0.55 },
  bulkBtnText: { color: '#1a1a1a', fontWeight: '600' },
  bulkPrimaryBtn: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8 },
  bulkPrimaryBtnText: { color: '#fff', fontWeight: '800' },
  modalList: { maxHeight: 360 },
  modalRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#eee' },
  modalRowInner: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  modalRowTextCol: { flex: 1, minWidth: 0 },
  modalRowText: { fontSize: 16, color: '#1a1a1a' },
  modalRowCat: { fontSize: 13, color: '#666', marginTop: 2 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#c9c5bf',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxTick: { fontSize: 14, fontWeight: '900', lineHeight: 16 },
  muted: { color: '#888', paddingVertical: 16 },
  modalClose: { marginTop: 12, alignItems: 'center', padding: 12 },
  modalCloseText: { color: '#2a6cb6', fontWeight: '600', fontSize: 16 },
});
