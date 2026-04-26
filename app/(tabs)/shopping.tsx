import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Keyboard,
  Platform,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';

import { useConfirmDialog } from '../../components/ConfirmDialog';
import { useAppTheme } from '../../components/ThemeContext';
import { ensureDatabaseAsync } from '../../lib/db';
import { appendShoppingStapleExcludeLine } from '../../lib/shoppingStaplesPrefs';
import {
  addManualShoppingItem,
  clearWeekShoppingItems,
  deleteShoppingItem,
  listShoppingItems,
  SHOPPING_INTERNAL_CATEGORY_WEEK,
  toggleShoppingItemChecked,
  type ShoppingItemRow,
} from '../../lib/shoppingRepo';

const UNIT_TOKENS = new Set(['g', 'gram', 'kg', 'ml', 'l', 'el', 'tl', 'tsp', 'tbsp', 'stuks', 'stuk']);

function parseManualShoppingInput(
  text: string
): { name: string; amount: number | null; unit: string | null } {
  const raw = text.trim();
  if (!raw) return { name: '', amount: null, unit: null };
  const sp = raw.indexOf(' ');
  if (sp === -1) {
    return { name: raw, amount: null, unit: null };
  }
  const firstToken = raw.slice(0, sp).replace(/,/g, '.');
  const rest = raw.slice(sp + 1).trim();
  const num = parseFloat(firstToken);
  if (!Number.isFinite(num) || num <= 0) {
    return { name: raw, amount: null, unit: null };
  }
  const rSp = rest.indexOf(' ');
  const w1 = rSp === -1 ? rest : rest.slice(0, rSp);
  const afterW1 = rSp === -1 ? '' : rest.slice(rSp + 1).trim();
  const w1lower = w1.toLowerCase();
  if (UNIT_TOKENS.has(w1lower)) {
    const unit = w1lower === 'gram' ? 'g' : w1lower;
    return { amount: num, unit, name: afterW1 };
  }
  return { amount: num, unit: null, name: rest };
}

export default function ShoppingScreen() {
  const theme = useAppTheme();
  const { confirm, ConfirmDialog } = useConfirmDialog();

  const [items, setItems] = useState<ShoppingItemRow[]>([]);
  const [newText, setNewText] = useState('');
  const [loading, setLoading] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [addBarHeight, setAddBarHeight] = useState(0);

  const reload = useCallback(() => {
    void (async () => {
      setLoading(true);
      try {
        await ensureDatabaseAsync();
        setItems(await listShoppingItems());
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const show = Keyboard.addListener('keyboardDidShow', (e) => setKeyboardHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const sections = useMemo(() => {
    const mijnLijstje = items.filter((i) => i.category !== SHOPPING_INTERNAL_CATEGORY_WEEK);
    const vanWeekmenu = items.filter((i) => i.category === SHOPPING_INTERNAL_CATEGORY_WEEK);
    return [
      { key: 'mijn', title: 'Mijn lijstje', data: mijnLijstje },
      { key: 'week', title: 'Van weekmenu', data: vanWeekmenu },
    ] as const;
  }, [items]);

  const onAdd = useCallback(() => {
    const t = newText.trim();
    if (!t) return;
    const parsed = parseManualShoppingInput(t);
    const name = parsed.name.trim();
    if (!name) return;
    void (async () => {
      await addManualShoppingItem({
        name,
        amount: parsed.amount,
        unit: parsed.unit,
      });
      setNewText('');
      reload();
    })();
  }, [newText, reload]);

  const onToggle = useCallback(
    (row: ShoppingItemRow) => {
      void (async () => {
        await toggleShoppingItemChecked(row.id, !row.isChecked);
        reload();
      })();
    },
    [reload]
  );

  const onDelete = useCallback(
    (row: ShoppingItemRow) => {
      void (async () => {
        await deleteShoppingItem(row.id);
        reload();
      })();
    },
    [reload]
  );

  const onMoveToStaples = useCallback(
    (row: ShoppingItemRow) => {
      void (async () => {
        const ok = await confirm({
          title: row.name,
          message:
            'Het item verdwijnt van je boodschappenlijst en staat voortaan op je lijst “altijd op voorraad” in instellingen (net als olie en kruiden).',
          confirmText: 'Zet item op standaard voorraad',
          cancelText: 'Annuleren',
        });
        if (!ok) return;
        await ensureDatabaseAsync();
        await appendShoppingStapleExcludeLine(row.name);
        await deleteShoppingItem(row.id);
        reload();
      })();
    },
    [confirm, reload]
  );

  const renderRightActions = useCallback(
    (row: ShoppingItemRow) => (
      <View style={styles.swipeActionWrap}>
        <Pressable
          style={styles.swipeAction}
          onPress={() => onDelete(row)}
          accessibilityLabel="Verwijderen"
        >
          <Text style={styles.swipeActionText}>Verwijderen</Text>
        </Pressable>
      </View>
    ),
    [onDelete]
  );

  const onClearWeekSection = useCallback(() => {
    const weekCount = items.filter((i) => i.category === SHOPPING_INTERNAL_CATEGORY_WEEK).length;
    if (weekCount === 0) return;
    void (async () => {
      const ok = await confirm({
        title: 'Weekmenu-items wissen?',
        message: 'Alle regels onder “Van weekmenu” worden verwijderd. “Mijn lijstje” blijft staan.',
        confirmText: 'Wissen',
        cancelText: 'Annuleren',
        destructive: true,
      });
      if (!ok) return;
      await ensureDatabaseAsync();
      await clearWeekShoppingItems();
      reload();
    })();
  }, [confirm, items, reload]);

  // Android: `KeyboardAvoidingView` + Tabs can "bounce" (briefly moves then snaps back).
  // Keep the list stable; only lift the bottom add-bar above the keyboard.
  const addBarBottom = Platform.OS === 'android' ? keyboardHeight : 0;
  const listPaddingBottom = Math.max(addBarHeight, 72) + 12;

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ConfirmDialog />
      <SectionList
        sections={sections}
        keyExtractor={(it) => String(it.id)}
        refreshing={loading}
        onRefresh={reload}
        style={styles.sectionList}
        contentContainerStyle={[styles.list, { paddingBottom: listPaddingBottom }]}
        renderSectionHeader={({ section }) => {
          const isWeek = section.key === 'week';
          const weekEmpty = isWeek && section.data.length === 0;
          return (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle} numberOfLines={1}>
                {section.title}
              </Text>
              {isWeek ? (
                <Pressable
                  onPress={onClearWeekSection}
                  disabled={weekEmpty}
                  style={[styles.sectionClearBtn, weekEmpty && styles.sectionClearBtnOff]}
                  accessibilityLabel="Van weekmenu wissen"
                  accessibilityState={{ disabled: weekEmpty }}
                >
                  <Text style={[styles.sectionClearBtnText, { color: theme.accent }, weekEmpty && styles.sectionClearBtnTextOff]}>
                    Wissen
                  </Text>
                </Pressable>
              ) : null}
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyBlock}>
            <Text style={styles.emptyHead}>Lekker leeg.</Text>
            <Text style={styles.emptySub}>
              Voeg iets toe of vul vanaf de weekplanner.
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const qty =
            item.amount != null
              ? `${String(item.amount)}${item.unit?.trim() ? ` ${item.unit.trim()}` : ''}`
              : (item.unit ?? '').trim();
          return (
            <Swipeable renderRightActions={() => renderRightActions(item)} overshootRight={false}>
              <View style={styles.row}>
                <Pressable
                  style={styles.checkBox}
                  onPress={() => onToggle(item)}
                  onLongPress={() => onMoveToStaples(item)}
                  delayLongPress={450}
                  accessibilityRole="checkbox"
                >
                  <View
                    style={[
                      styles.checkInner,
                      item.isChecked && { backgroundColor: theme.accent, borderColor: theme.accent },
                    ]}
                  />
                </Pressable>
                <Pressable
                  style={styles.rowMain}
                  onPress={() => onToggle(item)}
                  onLongPress={() => onMoveToStaples(item)}
                  delayLongPress={450}
                >
                  <Text style={[styles.name, item.isChecked && styles.nameChecked]} numberOfLines={2}>
                    {item.name}
                  </Text>
                  {qty ? <Text style={styles.qty}>{qty}</Text> : null}
                </Pressable>
              </View>
            </Swipeable>
          );
        }}
        ListFooterComponent={
          sections[0].data.length === 0 && sections[1].data.length === 0 ? null : (
            <View style={{ height: 12 }} />
          )
        }
        stickySectionHeadersEnabled={false}
        keyboardShouldPersistTaps="handled"
      />
      <View
        onLayout={(e) => setAddBarHeight(e.nativeEvent.layout.height)}
        style={[
          styles.addBar,
          { backgroundColor: theme.background, borderTopColor: '#e2ddd5', bottom: addBarBottom },
        ]}
      >
        <View style={styles.addRow}>
          <TextInput
            style={styles.input}
            placeholder="Voeg item toe…"
            placeholderTextColor="#999"
            value={newText}
            onChangeText={setNewText}
            onSubmitEditing={onAdd}
            blurOnSubmit={false}
            returnKeyType="done"
          />
          <Pressable
            style={[styles.addBtn, { backgroundColor: theme.accent }, !newText.trim() && styles.btnOff]}
            onPress={onAdd}
            disabled={!newText.trim()}
          >
            <Text style={styles.addBtnText}>Toevoegen</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  sectionList: { flex: 1 },
  addBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    borderTopWidth: 1,
  },
  list: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 12 },
  addRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#e2ddd5',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    backgroundColor: '#fff',
    color: '#1a1a1a',
  },
  addBtn: { paddingVertical: 12, paddingHorizontal: 14, borderRadius: 10 },
  addBtnText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  btnOff: { opacity: 0.5 },
  sectionHeader: {
    paddingTop: 10,
    paddingBottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 28,
  },
  sectionTitle: { flex: 1, fontSize: 13, fontWeight: '900', color: '#444' },
  sectionClearBtn: { paddingVertical: 4, paddingHorizontal: 8 },
  sectionClearBtnOff: { opacity: 0.35 },
  sectionClearBtnText: { fontSize: 13, fontWeight: '800' },
  sectionClearBtnTextOff: { color: '#999' },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2ddd5',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 8,
  },
  checkBox: { paddingTop: 2 },
  checkInner: { width: 20, height: 20, borderRadius: 6, borderWidth: 2, borderColor: '#c9c2b8', backgroundColor: '#fff' },
  rowMain: { flex: 1, minWidth: 0 },
  name: { fontSize: 14, fontWeight: '800', color: '#1a1a1a', lineHeight: 18 },
  nameChecked: { textDecorationLine: 'line-through', color: '#888' },
  qty: { fontSize: 12, color: '#666', marginTop: 4 },
  swipeActionWrap: { justifyContent: 'center' },
  swipeAction: {
    backgroundColor: '#b00020',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 8,
    marginLeft: 8,
    justifyContent: 'center',
    minHeight: 40,
  },
  swipeActionText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  emptyBlock: { paddingVertical: 40, paddingHorizontal: 16, alignItems: 'center' },
  emptyHead: { fontSize: 18, fontWeight: '800', color: '#444', textAlign: 'center' },
  emptySub: { fontSize: 14, color: '#666', textAlign: 'center', marginTop: 6, lineHeight: 20 },
});
