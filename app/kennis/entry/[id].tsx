import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useConfirmDialog } from '../../../components/ConfirmDialog';
import { useAppTheme } from '../../../components/ThemeContext';
import { IconArrowLeft, IconBook, IconPin, IconTag } from '../../../components/knowledge/icons';
import { IconEdit, IconTrash } from '../../../components/knowledge/entryIcons';
import { KennisColors, KennisRadii } from '../../../components/knowledge/tokens';
import {
  deleteKnowledgeEntry,
  getKnowledgeEntry,
  listKnowledgeTags,
  toggleKnowledgeEntryPinned,
  type KnowledgeEntryDetail,
  type KnowledgeTagBare,
} from '../../../lib/knowledgeRepo';

export default function KnowledgeEntryDetailScreen() {
  const theme = useAppTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { confirm, ConfirmDialog } = useConfirmDialog();
  const { id } = useLocalSearchParams<{ id: string }>();
  const entryId = Number.parseInt(id ?? '', 10);

  const [entry, setEntry] = useState<KnowledgeEntryDetail | null>(null);
  const [tags, setTags] = useState<KnowledgeTagBare[]>([]);

  const reload = useCallback(() => {
    if (!Number.isFinite(entryId)) return;
    void (async () => {
      const [e, t] = await Promise.all([getKnowledgeEntry(entryId), listKnowledgeTags()]);
      setEntry(e);
      setTags(t);
    })();
  }, [entryId]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  const tagByName = useMemo(() => {
    const m = new Map<string, KnowledgeTagBare>();
    for (const t of tags) m.set(t.name, t);
    return m;
  }, [tags]);

  if (!entry) {
    return (
      <View style={[styles.screen, { backgroundColor: theme.background }]}>
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
            style={styles.backBtn}
            hitSlop={{ top: 12, bottom: 12, right: 12, left: 4 }}
            accessibilityRole="button"
            accessibilityLabel="Terug"
          >
            <IconArrowLeft size={22} stroke={2} color={theme.accent} />
          </Pressable>
        </View>
        <View style={{ padding: 16 }}>
          <Text style={{ color: KennisColors.inkSoft }}>Laden…</Text>
        </View>
      </View>
    );
  }

  const hasRatio = Boolean(entry.ratio && entry.ratio.trim());

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <ConfirmDialog />
      <View
        style={[
          styles.headerWrap,
          {
            paddingTop: styles.headerWrap.paddingTop + Math.round(insets.top * 0.67),
            backgroundColor: theme.background,
          },
        ]}
      >
        <View style={styles.headerTopRow}>
          <Pressable
            onPress={() => router.back()}
            style={styles.backBtn}
            hitSlop={{ top: 12, bottom: 12, right: 12, left: 4 }}
            accessibilityRole="button"
            accessibilityLabel="Terug"
          >
            <IconArrowLeft size={22} stroke={2} color={theme.accent} />
          </Pressable>

          <View style={styles.headerActions}>
            <Pressable
              onPress={() => {
                void (async () => {
                  await toggleKnowledgeEntryPinned(entry.id);
                  reload();
                })();
              }}
              style={[
                styles.iconBtn,
                entry.isPinned ? { backgroundColor: theme.accentSoft } : null,
              ]}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={entry.isPinned ? 'Losmaken' : 'Pinnen'}
              accessibilityState={{ selected: entry.isPinned }}
            >
              <IconPin
                size={20}
                stroke={entry.isPinned ? 2.2 : 1.9}
                color={entry.isPinned ? theme.accent : KennisColors.inkMute}
              />
            </Pressable>

            <Pressable
              onPress={() => router.push(`/kennis/entry/${entry.id}/edit`)}
              style={styles.iconBtn}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Bewerken"
            >
              <IconEdit size={20} stroke={1.9} color={KennisColors.inkSoft} />
            </Pressable>

            <Pressable
              onPress={() => {
                void (async () => {
                  const ok = await confirm({
                    title: 'Kennis verwijderen?',
                    message: 'Deze kennis-entry wordt verwijderd.',
                    confirmText: 'Verwijderen',
                    cancelText: 'Annuleren',
                    destructive: true,
                  });
                  if (!ok) return;
                  await deleteKnowledgeEntry(entry.id);
                  router.back();
                })();
              }}
              style={styles.iconBtn}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Verwijderen"
            >
              <IconTrash size={20} stroke={1.9} color={'#9A3D3D'} />
            </Pressable>
          </View>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.title}>{entry.title}</Text>

        {hasRatio ? (
          <View style={styles.ratioRow}>
            <Text style={styles.ratioLabel}>Ratio</Text>
            <Text style={[styles.ratioValue, { color: theme.accent }]}>{entry.ratio}</Text>
          </View>
        ) : null}

        {entry.content?.trim() ? <Text style={styles.content}>{entry.content}</Text> : null}

        {entry.tagNames.length > 0 ? (
          <View style={{ marginTop: 18 }}>
            <View style={styles.subHeadRow}>
              <IconTag size={14} stroke={2} color={KennisColors.inkSoft} />
              <Text style={styles.subHead}>Tags</Text>
            </View>
            <View style={styles.tagWrap}>
              {entry.tagNames.map((name) => {
                const t = tagByName.get(name) ?? null;
                return (
                  <Pressable
                    key={name}
                    style={[
                      styles.tagChip,
                      t?.isSheet
                        ? { backgroundColor: theme.accentSoft, borderColor: theme.accentSoft }
                        : null,
                    ]}
                    onPress={() => {
                      if (!t) return;
                      router.push(`/kennis/sheet/${t.id}`);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Open tag ${name}`}
                  >
                    <Text style={[styles.tagChipText, t?.isSheet ? { color: theme.accent } : null]}>
                      {name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}

        {entry.sourceRecipeId != null ? (
          <View style={{ marginTop: 18 }}>
            <View style={styles.subHeadRow}>
              <IconBook size={14} stroke={1.8} color={KennisColors.inkSoft} />
              <Text style={styles.subHead}>Geleerd bij</Text>
            </View>
            <Pressable
              onPress={() => router.push(`/recipe/${entry.sourceRecipeId}`)}
              style={styles.recipeLinkRow}
              accessibilityRole="button"
              accessibilityLabel="Open recept"
            >
              <Text style={[styles.recipeLinkText, { color: theme.accent }]}>
                {entry.sourceRecipeTitle ?? 'Recept'}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  headerWrap: {
    borderBottomWidth: 1,
    borderBottomColor: KennisColors.borderSoft,
    paddingTop: 6,
    paddingHorizontal: 8,
    paddingBottom: 8,
  },
  headerTopRow: {
    height: 44,
    paddingHorizontal: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingLeft: 4,
    paddingRight: 8,
    gap: 2,
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 28 },
  title: { fontSize: 20, fontWeight: '700', color: KennisColors.ink, lineHeight: 24 },
  ratioRow: {
    marginTop: 14,
    backgroundColor: KennisColors.card,
    borderWidth: 1,
    borderColor: KennisColors.border,
    borderRadius: KennisRadii.card,
    padding: 12,
  },
  ratioLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.2,
    color: KennisColors.inkSoft,
    textTransform: 'uppercase',
  },
  ratioValue: { marginTop: 6, fontSize: 14, fontWeight: '600' },
  content: { marginTop: 14, fontSize: 14, lineHeight: 22, color: KennisColors.inkSoft },

  subHeadRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  subHead: { fontSize: 12, fontWeight: '700', color: KennisColors.inkSoft },
  tagWrap: { marginTop: 10, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tagChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: KennisRadii.pill,
    borderWidth: 1,
    borderColor: KennisColors.border,
    backgroundColor: KennisColors.card,
  },
  tagChipText: { fontSize: 12, fontWeight: '600', color: KennisColors.inkSoft },

  recipeLinkRow: {
    marginTop: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: KennisRadii.card,
    backgroundColor: KennisColors.card,
    borderWidth: 1,
    borderColor: KennisColors.border,
  },
  recipeLinkText: { fontWeight: '600' },
});
