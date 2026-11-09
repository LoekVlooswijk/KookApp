import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  IconClose,
  IconFlame,
  IconClock,
  IconHerb,
  IconPin,
  IconPlus,
  IconScale,
  IconSearch,
  IconSwap,
  IconThermometer,
} from '../../components/knowledge/icons';
import { KennisColors, KennisRadii } from '../../components/knowledge/tokens';
import { useAppTheme } from '../../components/ThemeContext';
import {
  listKnowledgeSheets,
  listLooseKnowledgeNotes,
  searchKnowledgeEntries,
  toggleKnowledgeEntryPinned,
  type KnowledgeEntryRow,
  type KnowledgeTagRow,
} from '../../lib/knowledgeRepo';

type UiRow =
  | { kind: 'sheets'; sheets: KnowledgeTagRow[] }
  | { kind: 'notes'; notes: KnowledgeEntryRow[]; looseCount: number }
  | { kind: 'search'; q: string; matches: KnowledgeEntryRow[] };

function plural(n: number, one: string, many: string) {
  return n === 1 ? one : many;
}

function excerpt(s: string, max = 160): string {
  const t = s.trim().replace(/\s+/g, ' ');
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function findMatchRanges(text: string, q: string): { start: number; end: number }[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const hay = text.toLowerCase();
  const idx = hay.indexOf(needle);
  if (idx === -1) return [];
  return [{ start: idx, end: idx + needle.length }];
}

function HighlightText({ text, q, style }: { text: string; q: string; style?: any }) {
  const ranges = findMatchRanges(text, q);
  if (ranges.length === 0) return <Text style={style}>{text}</Text>;
  const r = ranges[0]!;
  return (
    <Text style={style}>
      {text.slice(0, r.start)}
      <Text style={{ backgroundColor: KennisColors.searchMark, borderRadius: 2 }}>
        {text.slice(r.start, r.end)}
      </Text>
      {text.slice(r.end)}
    </Text>
  );
}

function SectionLabel({ left, right }: { left: string; right?: string }) {
  return (
    <View style={styles.sectionLabelRow}>
      <Text style={styles.sectionLabelText}>{left}</Text>
      {right ? <Text style={styles.sectionLabelMeta}>{right}</Text> : null}
    </View>
  );
}

function SheetTile({ sheet, onPress }: { sheet: KnowledgeTagRow; onPress: () => void }) {
  const accent = useMemo(() => {
    const k = sheet.accent ?? '';
    if (k === 'sage') return KennisColors.sage;
    if (k === 'ochre') return KennisColors.ochre;
    if (k === 'rust') return KennisColors.rust;
    if (k === 'sky') return KennisColors.sky;
    if (k === 'clay') return KennisColors.clay;
    if (k === 'lavender') return KennisColors.lavender;
    return KennisColors.greenSoft;
  }, [sheet.accent]);

  const IllustrationIcon = useMemo(() => {
    const k = (sheet.icon ?? '').toLowerCase();
    if (k === 'herb') return IconHerb;
    if (k === 'scale') return IconScale;
    if (k === 'thermometer') return IconThermometer;
    if (k === 'swap') return IconSwap;
    if (k === 'flame') return IconFlame;
    if (k === 'clock') return IconClock;
    return null;
  }, [sheet.icon]);

  const isTechniques = (sheet.name ?? '').toLowerCase() === 'technieken';

  return (
    <Pressable
      style={[
        styles.sheetTile,
        sheet.isWide ? styles.sheetTileWide : null,
        sheet.isWide ? { flexDirection: 'row', alignItems: 'center', gap: 12 } : null,
      ]}
      onPress={onPress}
    >
      {isTechniques ? (
        <View style={styles.sheetTileIllustration} pointerEvents="none">
          <IconFlame
            size={72}
            stroke={1.4}
            color={accent}
            style={{
              position: 'absolute',
              right: -6,
              top: '50%',
              transform: [{ translateY: -36 }],
              opacity: 0.9,
            }}
          />
        </View>
      ) : IllustrationIcon ? (
        <View style={styles.sheetTileIllustration} pointerEvents="none">
          <IllustrationIcon
            size={88}
            stroke={1.4}
            color={accent}
            style={{ position: 'absolute', right: -10, bottom: -14, opacity: 0.9 }}
          />
        </View>
      ) : null}
      <View style={{ position: 'relative', flex: sheet.isWide ? 1 : undefined }}>
        <Text style={styles.sheetTileTitle} numberOfLines={2}>
          {sheet.name}
        </Text>
        <Text style={styles.sheetTileMeta}>
          {sheet.entryCount} {plural(sheet.entryCount, 'kaart', 'kaarten')}
        </Text>
      </View>
    </Pressable>
  );
}

function PinButton({
  pinned,
  onPress,
  accent,
  accentSoft,
}: {
  pinned: boolean;
  onPress: () => void;
  accent: string;
  accentSoft: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.pinBtn,
        pinned ? { backgroundColor: accentSoft } : styles.pinBtnOff,
        !pinned ? { transform: [{ rotate: '35deg' }] } : null,
      ]}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={pinned ? 'Losmaken' : 'Pinnen'}
      accessibilityState={{ selected: pinned }}
    >
      <IconPin
        size={16}
        stroke={pinned ? 2.2 : 1.8}
        color={pinned ? accent : KennisColors.inkMute}
      />
    </Pressable>
  );
}

function NoteCard({
  entry,
  onTogglePin,
  onPress,
  accent,
  accentSoft,
  tagPillBackground,
}: {
  entry: KnowledgeEntryRow;
  onTogglePin: () => void;
  onPress: () => void;
  accent: string;
  accentSoft: string;
  tagPillBackground: string;
}) {
  return (
    <Pressable
      style={[styles.noteCard, entry.isPinned ? { borderColor: accent } : null]}
      onPress={onPress}
    >
      <View style={styles.noteHeaderRow}>
        <Text style={styles.noteTitle} numberOfLines={2}>
          {entry.title}
        </Text>
        <PinButton
          pinned={entry.isPinned}
          onPress={onTogglePin}
          accent={accent}
          accentSoft={accentSoft}
        />
      </View>
      <Text style={styles.noteBody} numberOfLines={2}>
        {entry.content ?? ''}
      </Text>
      {entry.tagNames.length > 0 ? (
        <View style={styles.tagRow}>
          {entry.tagNames.map((t) => (
            <View key={t} style={[styles.tagPill, { backgroundColor: tagPillBackground }]}>
              <Text style={styles.tagPillText}>{t}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </Pressable>
  );
}

export default function KennisbankScreen() {
  const theme = useAppTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [sheets, setSheets] = useState<KnowledgeTagRow[]>([]);
  const [notes, setNotes] = useState<KnowledgeEntryRow[]>([]);
  const [searchMatches, setSearchMatches] = useState<KnowledgeEntryRow[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(() => {
    void (async () => {
      setLoading(true);
      try {
        const [s, n] = await Promise.all([listKnowledgeSheets(), listLooseKnowledgeNotes()]);
        setSheets(s);
        setNotes(n);
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

  const q = query.trim();
  const isSearching = q.length > 0;

  const runSearch = useCallback((next: string) => {
    setQuery(next);
    const trimmed = next.trim();
    if (!trimmed) {
      setSearchMatches([]);
      return;
    }
    void (async () => {
      const res = await searchKnowledgeEntries(trimmed);
      setSearchMatches(res);
    })();
  }, []);

  const rows: UiRow[] = useMemo(() => {
    if (isSearching) return [{ kind: 'search', q, matches: searchMatches }];
    return [
      { kind: 'sheets', sheets },
      { kind: 'notes', notes, looseCount: notes.length },
    ];
  }, [isSearching, notes, q, searchMatches, sheets]);

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.kind}
        contentContainerStyle={styles.scrollContent}
        stickyHeaderIndices={[0]}
        ListHeaderComponent={
          <View
            style={[
              styles.searchBarWrap,
              {
                paddingTop: styles.searchBarWrap.paddingTop + Math.round(insets.top * 0.67),
                backgroundColor: theme.background,
              },
              q ? styles.searchBarWrapBorder : null,
            ]}
          >
            <View style={styles.searchPill}>
              <IconSearch size={18} stroke={1.8} color={KennisColors.inkMute} />
              <TextInput
                style={styles.searchInput}
                placeholder="Zoek in kennisbank..."
                placeholderTextColor={KennisColors.inkMute}
                value={query}
                onChangeText={runSearch}
                autoCorrect={false}
                autoCapitalize="none"
              />
              {q ? (
                <Pressable
                  onPress={() => runSearch('')}
                  style={[styles.searchClearBtn, { backgroundColor: theme.background }]}
                  accessibilityRole="button"
                  accessibilityLabel="Zoekopdracht wissen"
                >
                  <IconClose size={14} stroke={2} color={KennisColors.inkSoft} />
                </Pressable>
              ) : null}
            </View>
          </View>
        }
        renderItem={({ item }) => {
          if (item.kind === 'search') {
            const m = item.matches;
            if (m.length === 0) {
              return (
                <View style={styles.searchEmpty}>
                  <IconSearch size={32} stroke={1.4} color={KennisColors.inkSoft} />
                  <Text style={styles.searchEmptyText}>{`Geen resultaten voor "${item.q}"`}</Text>
                </View>
              );
            }
            return (
              <View style={styles.searchResultsWrap}>
                <SectionLabel left={`${m.length} ${plural(m.length, 'resultaat', 'resultaten')}`} />
                <View style={styles.vGap10}>
                  {m.map((e) => (
                    <Pressable
                      key={e.id}
                      style={styles.searchCard}
                      onPress={() => router.push(`/kennis/entry/${e.id}`)}
                    >
                      <View style={styles.searchCardTopRow}>
                        <HighlightText text={e.title} q={item.q} style={styles.searchCardTitle} />
                        {e.ratio ? (
                          <View style={[styles.ratioBadge, { backgroundColor: theme.accentSoft }]}>
                            <Text style={[styles.ratioBadgeText, { color: theme.accent }]}>
                              {e.ratio}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                      <HighlightText
                        text={excerpt(e.content ?? '', 160)}
                        q={item.q}
                        style={styles.searchCardBody}
                      />
                      {e.tagNames.length > 0 ? (
                        <View style={styles.searchTagRow}>
                          {e.tagNames.map((t) => (
                            <View
                              key={`${e.id}-tag-${t}`}
                              style={[styles.searchTagChip, { backgroundColor: theme.accentSoft }]}
                            >
                              <Text style={[styles.searchTagChipText, { color: theme.accent }]}>
                                {t}
                              </Text>
                            </View>
                          ))}
                        </View>
                      ) : null}
                    </Pressable>
                  ))}
                </View>
              </View>
            );
          }

          if (item.kind === 'sheets') {
            return (
              <View style={styles.sheetsSection}>
                <View style={styles.sheetGrid}>
                  {item.sheets.map((s) => (
                    <SheetTile
                      key={s.id}
                      sheet={s}
                      onPress={() => router.push(`/kennis/sheet/${s.id}`)}
                    />
                  ))}
                </View>
              </View>
            );
          }

          return (
            <View style={styles.notesSection}>
              <SectionLabel left="NOTITIES" right={`${item.looseCount} losse`} />
              <View style={styles.vGap10}>
                {item.notes.map((e) => (
                  <NoteCard
                    key={e.id}
                    entry={e}
                    accent={theme.accent}
                    accentSoft={theme.accentSoft}
                    tagPillBackground={theme.background}
                    onTogglePin={() => {
                      const curPinned = e.isPinned;
                      setNotes((prev) =>
                        prev.map((x) => (x.id === e.id ? { ...x, isPinned: !curPinned } : x))
                      );
                      void (async () => {
                        try {
                          await toggleKnowledgeEntryPinned(e.id);
                        } finally {
                          reload();
                        }
                      })();
                    }}
                    onPress={() => router.push(`/kennis/entry/${e.id}`)}
                  />
                ))}
              </View>
            </View>
          );
        }}
      />

      <Pressable
        style={[
          styles.fab,
          { backgroundColor: theme.accent, shadowColor: theme.accent },
          loading && styles.fabOff,
        ]}
        accessibilityRole="button"
        accessibilityLabel="Nieuwe kennis toevoegen"
        onPress={() => router.push('/kennis/entry/new')}
        disabled={loading}
      >
        <IconPlus size={26} stroke={2.2} color="#fff" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },

  scrollContent: { paddingBottom: 24 },

  searchBarWrap: {
    paddingTop: 3,
    paddingHorizontal: 16,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: 'transparent',
  },
  searchBarWrapBorder: { borderBottomColor: KennisColors.borderSoft },
  searchPill: {
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
  searchInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 14.5,
    color: KennisColors.ink,
  },
  searchClearBtn: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: KennisColors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },

  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  sectionLabelText: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.2,
    color: KennisColors.inkSoft,
  },
  sectionLabelMeta: {
    marginLeft: 'auto',
    fontSize: 11,
    color: KennisColors.inkMute,
    fontWeight: '400',
    letterSpacing: 0,
  },

  sheetsSection: { paddingTop: 8, paddingHorizontal: 16, paddingBottom: 4 },
  sheetGrid: {
    marginTop: 6,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  sheetTile: {
    width: '48.5%',
    minHeight: 112,
    paddingTop: 14,
    paddingHorizontal: 14,
    paddingBottom: 12,
    backgroundColor: KennisColors.card,
    borderWidth: 1,
    borderColor: KennisColors.border,
    borderRadius: KennisRadii.tile,
    position: 'relative',
    overflow: 'hidden',
    justifyContent: 'flex-start',
    gap: 10,
  },
  sheetTileWide: {
    width: '100%',
    minHeight: 64,
    paddingTop: 12,
    paddingBottom: 12,
  },
  sheetTileIllustration: { position: 'absolute', inset: 0 },
  sheetTileTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: KennisColors.ink,
    lineHeight: 18,
  },
  sheetTileMeta: { fontSize: 12, fontWeight: '400', color: KennisColors.inkSoft, marginTop: 6 },

  notesSection: { paddingTop: 20, paddingHorizontal: 16, paddingBottom: 24 },
  vGap10: { marginTop: 10, gap: 10 },

  noteCard: {
    backgroundColor: KennisColors.card,
    borderWidth: 1,
    borderColor: KennisColors.border,
    borderRadius: KennisRadii.card,
    padding: 14,
    gap: 6,
  },
  noteHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  noteTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    fontWeight: '600',
    color: KennisColors.ink,
    lineHeight: 20,
  },
  noteBody: { fontSize: 13.5, fontWeight: '400', color: KennisColors.inkSoft, lineHeight: 20 },

  tagRow: { marginTop: 4, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tagPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: KennisRadii.pill,
    borderWidth: 1,
    borderColor: KennisColors.border,
  },
  tagPillText: { fontSize: 11, fontWeight: '500', color: KennisColors.inkSoft },

  pinBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  pinBtnOff: { backgroundColor: 'transparent' },

  fab: {
    position: 'absolute',
    right: 16,
    bottom: 16,
    width: 56,
    height: 56,
    borderRadius: KennisRadii.fab,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.32,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  fabOff: { opacity: 0.7 },

  searchResultsWrap: { paddingTop: 14, paddingHorizontal: 16, paddingBottom: 24 },
  searchEmpty: { paddingTop: 60, paddingHorizontal: 24, alignItems: 'center' },
  searchEmptyText: { marginTop: 8, fontSize: 14, color: KennisColors.inkSoft, textAlign: 'center' },
  searchCard: {
    backgroundColor: KennisColors.card,
    borderWidth: 1,
    borderColor: KennisColors.border,
    borderRadius: KennisRadii.card,
    padding: 14,
    gap: 6,
  },
  searchCardTopRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  searchCardTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    fontWeight: '600',
    color: KennisColors.ink,
  },
  searchCardBody: { fontSize: 13.5, color: KennisColors.inkSoft, lineHeight: 20 },
  ratioBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: KennisRadii.pill,
  },
  ratioBadgeText: { fontSize: 11, fontWeight: '600' },
  searchTagRow: { marginTop: 4, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  searchTagChip: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: KennisRadii.pill,
  },
  searchTagChipText: { fontSize: 11, fontWeight: '600' },
});
