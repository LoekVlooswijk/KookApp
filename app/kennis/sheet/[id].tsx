import { useFocusEffect } from 'expo-router';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppTheme } from '../../../components/ThemeContext';
import {
  IconArrowLeft,
  IconFlame,
  IconHerb,
  IconPlus,
  IconScale,
  IconSwap,
  IconThermometer,
} from '../../../components/knowledge/icons';
import { KennisColors, KennisRadii } from '../../../components/knowledge/tokens';
import {
  getKnowledgeTag,
  listKnowledgeEntriesForTag,
  type KnowledgeEntryRow,
  type KnowledgeTagBare,
} from '../../../lib/knowledgeRepo';

function plural(n: number, one: string, many: string) {
  return n === 1 ? one : many;
}

export default function SheetDetailScreen() {
  const theme = useAppTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const tagId = Number.parseInt(id ?? '', 10);

  const [sheet, setSheet] = useState<KnowledgeTagBare | null>(null);
  const [entries, setEntries] = useState<KnowledgeEntryRow[]>([]);

  const reload = useCallback(() => {
    if (!Number.isFinite(tagId)) return;
    void (async () => {
      const [tag, ents] = await Promise.all([
        getKnowledgeTag(tagId),
        listKnowledgeEntriesForTag(tagId),
      ]);
      setSheet(tag);
      setEntries(ents);
    })();
  }, [tagId]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  const accent = useMemo(() => {
    const k = sheet?.accent ?? '';
    if (k === 'sage') return KennisColors.sage;
    if (k === 'ochre') return KennisColors.ochre;
    if (k === 'rust') return KennisColors.rust;
    if (k === 'sky') return KennisColors.sky;
    return KennisColors.greenSoft;
  }, [sheet?.accent]);

  const BadgeIcon = useMemo(() => {
    const k = (sheet?.icon ?? '').toLowerCase();
    if (k === 'herb') return IconHerb;
    if (k === 'scale') return IconScale;
    if (k === 'thermometer') return IconThermometer;
    if (k === 'swap') return IconSwap;
    if (k === 'flame') return IconFlame;
    return null;
  }, [sheet?.icon]);

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
        <View style={styles.headerTopRow}>
          <View style={styles.headerLeftRow}>
            <Pressable
              onPress={() => router.back()}
              style={styles.backBtn}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel="Terug"
            >
              <IconArrowLeft size={24} stroke={2} color={theme.accent} />
            </Pressable>
          </View>
        </View>

        <View style={styles.identityRow}>
          <View style={[styles.identityIcon, { backgroundColor: accent }]}>
            {BadgeIcon ? <BadgeIcon size={28} stroke={1.7} color={KennisColors.ink} /> : null}
          </View>
          <View style={styles.identityTextCol}>
            <Text style={styles.identityEyebrow}>SHEET</Text>
            <Text style={styles.identityTitle} numberOfLines={2}>
              {sheet?.name ?? 'Sheet'}
            </Text>
            <Text style={styles.identityMeta}>
              {entries.length} {plural(entries.length, 'kaart', 'kaarten')}
            </Text>
          </View>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.listContent}>
        <View style={styles.vGap10}>
          {entries.map((e) => (
            <Pressable
              key={e.id}
              style={styles.card}
              onPress={() => router.push(`/kennis/entry/${e.id}`)}
            >
              <View style={styles.cardTopRow}>
                <Text style={styles.cardTitle} numberOfLines={2}>
                  {e.title}
                </Text>
                {e.ratio ? (
                  <View style={[styles.ratioBadge, { backgroundColor: theme.accentSoft }]}>
                    <Text style={[styles.ratioBadgeText, { color: theme.accent }]}>{e.ratio}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.cardBody}>{e.content ?? ''}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      <Pressable
        style={[styles.fab, { backgroundColor: theme.accent, shadowColor: theme.accent }]}
        accessibilityRole="button"
        accessibilityLabel="Nieuwe kennis toevoegen"
        onPress={() =>
          router.push({ pathname: '/kennis/entry/new', params: { tagId: String(tagId) } })
        }
      >
        <IconPlus size={26} stroke={2.2} color="#fff" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  headerWrap: {
    borderBottomWidth: 1,
    borderBottomColor: KennisColors.borderSoft,
    paddingTop: 8,
    paddingHorizontal: 8,
    paddingBottom: 12,
  },
  headerTopRow: {
    height: 44,
    paddingHorizontal: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeftRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  backBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerIconBadge: { display: 'none' },
  identityRow: {
    paddingTop: 8,
    paddingLeft: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  identityIcon: {
    width: 52,
    height: 52,
    borderRadius: KennisRadii.iconBadgeLg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  identityTextCol: { flex: 1, minWidth: 0 },
  identityEyebrow: {
    fontSize: 11,
    fontWeight: '600',
    color: KennisColors.inkMute,
    letterSpacing: 1.2,
  },
  identityTitle: {
    fontSize: 22,
    fontWeight: '600',
    color: KennisColors.ink,
    letterSpacing: -0.2,
    lineHeight: 24,
    marginTop: 2,
  },
  identityMeta: { fontSize: 12.5, fontWeight: '400', color: KennisColors.inkSoft, marginTop: 4 },

  listContent: { paddingTop: 14, paddingHorizontal: 16, paddingBottom: 24 },
  vGap10: { gap: 10 },
  card: {
    backgroundColor: KennisColors.card,
    borderWidth: 1,
    borderColor: KennisColors.border,
    borderRadius: KennisRadii.card,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 12,
    gap: 6,
  },
  cardTopRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  cardTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    fontWeight: '600',
    color: KennisColors.ink,
    lineHeight: 20,
  },
  cardBody: { fontSize: 13.5, color: KennisColors.inkSoft, lineHeight: 21 },
  ratioBadge: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: KennisRadii.pill,
  },
  ratioBadgeText: { fontSize: 11.5, fontWeight: '600' },

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
});
