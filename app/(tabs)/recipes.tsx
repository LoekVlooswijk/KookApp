import { useFocusEffect } from 'expo-router';
import Slider from '@react-native-community/slider';
import { Link, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Modal,
  PixelRatio,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  PanGestureHandler,
  State as GestureState,
  type PanGestureHandlerStateChangeEvent,
} from 'react-native-gesture-handler';

import { Ionicons } from '@expo/vector-icons';
import { RecipeListThumb } from '../../components/RecipeListThumb';
import { useAppTheme } from '../../components/ThemeContext';
import { getAiCookProfile, hydrateAiCookProfileFromDb } from '../../lib/aiCookProfile';
import { ensureDatabaseAsync } from '../../lib/db';
import { safeErrorMessage } from '../../lib/logSafe';
import { getCustomDiets } from '../../lib/dietPrefs';
import {
  createList,
  getRecipeListMembership,
  listAllLists,
  setRecipeInList,
  type RecipeListSummary,
} from '../../lib/listsRepo';
import {
  countRecipes,
  getLastOpenedRecipe,
  listDistinctRecipeCategories,
  listDistinctRecipeTags,
  listRecipes,
  searchRecipes,
  setRecipeFavoriteFlag,
  setRecipeWantToTryFlag,
  type RecipeBrowseFilters,
} from '../../lib/recipesRepo';
import { duplicateRecipe } from '../../lib/recipesRepo';
import type { RecipeListItem } from '../../lib/types';
import { discoverRecipes } from '../../lib/recipeDiscovery';
import {
  addDays,
  listWeekPlansBetween,
  toIsoDateOnly,
  upsertWeekPlan,
} from '../../lib/weekPlansRepo';

const emptyRecipeList: RecipeListItem[] = [];

/** Horizontale marge voor hoofdinhoud (recepten-tab). */
const SCREEN_EDGE = 10;
const TILE_GAP = 8;
const TILE_COLS = 3;

export default function RecipesScreen() {
  const theme = useAppTheme();
  const router = useRouter();
  const { width: windowWidth } = useWindowDimensions();
  const listRef = useRef<FlatList<RecipeListItem>>(null);
  const [searchBlockY, setSearchBlockY] = useState(0);
  const [lastOpenedRecipe, setLastOpenedRecipe] = useState<RecipeListItem | null>(null);
  const [lists, setLists] = useState<RecipeListSummary[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [recipeTags, setRecipeTags] = useState<string[]>([]);
  const [customDiets, setCustomDiets] = useState<string[]>([]);
  const [dataTick, setDataTick] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryKey, setCategoryKey] = useState<string | null>(null);
  const [tagKeys, setTagKeys] = useState<string[]>([]);
  const [dietKeys, setDietKeys] = useState<string[]>([]);
  const [customDietKeys, setCustomDietKeys] = useState<string[]>([]);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [wantToTryOnly, setWantToTryOnly] = useState(false);
  const [maxTotalTimeMin, setMaxTotalTimeMin] = useState<number | null>(null);
  const [inListId, setInListId] = useState<number | null>(null);
  const [view, setView] = useState<'recepten' | 'lijsten'>('recepten');
  const [listsQuery, setListsQuery] = useState('');
  const [filtersModalOpen, setFiltersModalOpen] = useState(false);
  const [discoveredIds, setDiscoveredIds] = useState<number[] | null>(null);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [tagsPickerOpen, setTagsPickerOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [cardActionFor, setCardActionFor] = useState<RecipeListItem | null>(null);
  const [listPickFor, setListPickFor] = useState<RecipeListItem | null>(null);
  const [listPickRows, setListPickRows] = useState<{ id: number; name: string; member: boolean }[]>(
    []
  );
  const [quickPlanFor, setQuickPlanFor] = useState<RecipeListItem | null>(null);
  const [quickPlanBusy, setQuickPlanBusy] = useState(false);
  const [quickPlanDefaultServings, setQuickPlanDefaultServings] = useState(2);
  const [quickPlanPlannedTitleByDate, setQuickPlanPlannedTitleByDate] = useState<
    Record<string, string>
  >({});
  const swipeX = useRef(new Animated.Value(0)).current;
  const segmentThumbT = useRef(new Animated.Value(0)).current;
  const [segmentWidth, setSegmentWidth] = useState(0);

  const quickToday = useMemo(() => toIsoDateOnly(new Date()), []);
  const quickDates = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(quickToday, i)),
    [quickToday]
  );

  function weekdayNl(dateOnly: string): string {
    const [y, m, d] = dateOnly.split('-').map((x) => Number.parseInt(x, 10));
    const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
    const days = [
      'zondag',
      'maandag',
      'dinsdag',
      'woensdag',
      'donderdag',
      'vrijdag',
      'zaterdag',
    ] as const;
    return days[dt.getDay()] ?? dateOnly;
  }

  function labelForIndex(i: number, dateOnly: string): string {
    const wd = weekdayNl(dateOnly);
    if (i === 0) return `Vandaag (${wd})`;
    if (i === 1) return `Morgen (${wd})`;
    if (i === 2) return `Overmorgen (${wd})`;
    return wd;
  }

  const openQuickPlan = useCallback(
    (it: RecipeListItem) => {
      setQuickPlanFor(it);
      setQuickPlanBusy(true);
      void (async () => {
        try {
          await ensureDatabaseAsync();
          await hydrateAiCookProfileFromDb();
          setQuickPlanDefaultServings(getAiCookProfile().defaultServings ?? 2);

          const [plans, allRecipes] = await Promise.all([
            listWeekPlansBetween(quickDates[0]!, quickDates[quickDates.length - 1]!),
            listRecipes(),
          ]);
          const titleById = new Map<number, string>();
          for (const r of allRecipes) titleById.set(r.id, r.title);

          const plansByDate: Record<string, { recipeId: number; leftoverOfDate: string | null }> =
            {};
          for (const p of plans) {
            plansByDate[p.date] = {
              recipeId: p.recipeId,
              leftoverOfDate: p.leftoverOfDate ?? null,
            };
          }

          const out: Record<string, string> = {};
          for (const d of quickDates) {
            const p = plansByDate[d] ?? null;
            if (!p) {
              out[d] = '— leeg —';
              continue;
            }
            if (p.leftoverOfDate) {
              const src = plansByDate[p.leftoverOfDate] ?? null;
              const srcRid = src?.recipeId ?? p.recipeId;
              out[d] = `Restjes: ${titleById.get(srcRid) ?? 'Onbekend recept'}`;
            } else {
              out[d] = titleById.get(p.recipeId) ?? 'Onbekend recept';
            }
          }
          setQuickPlanPlannedTitleByDate(out);
        } finally {
          setQuickPlanBusy(false);
        }
      })();
    },
    [quickDates]
  );

  const quickAddToDate = useCallback(
    (date: string) => {
      const it = quickPlanFor;
      if (!it) return;
      setQuickPlanBusy(true);
      void (async () => {
        try {
          await upsertWeekPlan({
            date,
            recipeId: it.id,
            servings: quickPlanDefaultServings,
            cooksForDays: 1,
            leftoverOfDate: null,
          });
          setQuickPlanFor(null);
        } finally {
          setQuickPlanBusy(false);
        }
      })();
    },
    [quickPlanDefaultServings, quickPlanFor]
  );

  const handleDiscover = useCallback(async () => {
    if (searchQuery.length < 5) return;

    // If already showing discovered results, clear the filter
    if (discoveredIds) {
      setDiscoveredIds(null);
      return;
    }

    setDiscoverLoading(true);

    try {
      const results = await discoverRecipes(searchQuery);
      if (results.length === 0) {
        Alert.alert(
          'Geen recepten gevonden',
          'Er zijn geen recepten die passen bij je zoekopdracht.'
        );
      } else {
        setDiscoveredIds(results.map((r) => r.id));
      }
    } catch (e) {
      Alert.alert('Fout', 'Kon recepten niet ophalen. Probeer het opnieuw.');
    } finally {
      setDiscoverLoading(false);
    }
  }, [searchQuery, discoveredIds]);

  const canSwipe = !filtersModalOpen && !modalOpen && !tagsPickerOpen;

  // Clear discoveredIds when search query is empty
  useEffect(() => {
    if (searchQuery.length === 0) {
      setDiscoveredIds(null);
    }
  }, [searchQuery]);

  useEffect(() => {
    Animated.spring(segmentThumbT, {
      toValue: view === 'recepten' ? 0 : 1,
      useNativeDriver: false,
      speed: 18,
      bounciness: 6,
    }).start();
  }, [segmentThumbT, view]);

  const onSwipeStateChange = useCallback(
    (e: PanGestureHandlerStateChangeEvent) => {
      if (!canSwipe) return;
      if (e.nativeEvent.state !== GestureState.END) return;
      const dx = e.nativeEvent.translationX ?? 0;
      const vx = e.nativeEvent.velocityX ?? 0;
      const should = Math.abs(dx) > 70 || Math.abs(vx) > 600;
      Animated.timing(swipeX, { toValue: 0, duration: 140, useNativeDriver: false }).start();
      if (!should) return;

      if (dx < 0 && view === 'recepten') setView('lijsten');
      if (dx > 0 && view === 'lijsten') setView('recepten');
    },
    [canSwipe, view]
  );

  const filteredLists = useMemo(() => {
    const q = listsQuery.trim().toLowerCase();
    if (!q) return lists;
    return lists.filter((l) => l.name.toLowerCase().includes(q));
  }, [lists, listsQuery]);

  const listTileWidth = useMemo(() => {
    const w = (windowWidth - SCREEN_EDGE * 2 - TILE_GAP * (TILE_COLS - 1)) / TILE_COLS;
    return Math.max(72, w);
  }, [windowWidth]);

  const listBoxPalettes = useMemo(
    () => [
      {
        bg: theme.accentSoft,
        border: theme.accentBorderMuted,
        text: theme.accentSoftText,
      },
      { bg: '#eef4fb', border: '#c5d6eb', text: '#2a4a7a' },
      { bg: '#f0f4ef', border: '#c5d4c0', text: '#2d4a2d' },
    ],
    [theme.accentSoft, theme.accentBorderMuted, theme.accentSoftText]
  );

  const chipOnStyle = useMemo(
    () => ({ backgroundColor: theme.accentSoft, borderColor: theme.accent }),
    [theme.accentSoft, theme.accent]
  );
  const chipTextOnStyle = useMemo(() => ({ color: theme.accentSoftText }), [theme.accentSoftText]);

  const extraTags = recipeTags;
  const tagKeyInExtra = tagKeys.length > 0;

  const selectedTagSet = useMemo(() => new Set<string>(tagKeys), [tagKeys]);
  const toggleTag = useCallback((t: string) => {
    setTagKeys((prev) => {
      const s = new Set(prev);
      if (s.has(t)) s.delete(t);
      else s.add(t);
      return Array.from(s);
    });
  }, []);
  const clearTags = useCallback(() => setTagKeys([]), []);

  const selectedDietSet = useMemo(() => new Set<string>(dietKeys), [dietKeys]);
  const toggleDiet = useCallback((k: string) => {
    setDietKeys((prev) => {
      const s = new Set(prev);
      if (s.has(k)) s.delete(k);
      else s.add(k);
      return Array.from(s);
    });
  }, []);
  const clearDiet = useCallback(() => setDietKeys([]), []);

  const selectedCustomDietSet = useMemo(() => new Set<string>(customDietKeys), [customDietKeys]);
  const toggleCustomDiet = useCallback((name: string) => {
    setCustomDietKeys((prev) => {
      const s = new Set(prev);
      if (s.has(name)) s.delete(name);
      else s.add(name);
      return Array.from(s);
    });
  }, []);
  const clearCustomDiets = useCallback(() => setCustomDietKeys([]), []);

  const browseFilters = useMemo(
    (): RecipeBrowseFilters => ({
      query: searchQuery,
      category: categoryKey,
      tagNames: tagKeys,
      dietKeys,
      customDietNames: customDietKeys,
      favoritesOnly,
      wantToTryOnly,
      maxTotalTimeMin,
      inListId,
    }),
    [
      searchQuery,
      categoryKey,
      tagKeys,
      dietKeys,
      customDietKeys,
      favoritesOnly,
      wantToTryOnly,
      maxTotalTimeMin,
      inListId,
    ]
  );

  // When showing discovered results, don't apply the search query filter
  // (the discoveredIds filter will be applied separately)
  const effectiveBrowseFilters = useMemo(() => {
    if (discoveredIds) {
      return { ...browseFilters, query: '' };
    }
    return browseFilters;
  }, [browseFilters, discoveredIds]);

  const [items, setItems] = useState<RecipeListItem[]>(emptyRecipeList);
  const [totalRecipeCount, setTotalRecipeCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [rows, total] = await Promise.all([
          searchRecipes(effectiveBrowseFilters),
          countRecipes(),
        ]);
        if (!cancelled) {
          // Filter by discoveredIds if active
          const filteredRows = discoveredIds
            ? rows.filter((r) => discoveredIds.includes(r.id))
            : rows;
          setItems(filteredRows);
          setTotalRecipeCount(total);
        }
      } catch (e) {
        console.error(safeErrorMessage(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [effectiveBrowseFilters, dataTick, discoveredIds]);

  // Load last opened recipe
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const lastOpened = await getLastOpenedRecipe();
        if (!cancelled) {
          setLastOpenedRecipe(lastOpened);
        }
      } catch (e) {
        console.error(safeErrorMessage(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dataTick]);

  const toggleFavoriteFromList = useCallback((recipeId: number) => {
    setItems((prev) => {
      const it = prev.find((x) => x.id === recipeId);
      if (!it) return prev;
      const nextFav = !it.isFavorite;

      void (async () => {
        try {
          await setRecipeFavoriteFlag(recipeId, nextFav);
        } catch (e) {
          console.error(safeErrorMessage(e));
          setItems((p2) =>
            p2.map((x) => (x.id === recipeId ? { ...x, isFavorite: it.isFavorite } : x))
          );
          Alert.alert('Kon favorieten niet bijwerken.', 'Probeer het opnieuw.');
        }
      })();

      return prev.map((x) => (x.id === recipeId ? { ...x, isFavorite: nextFav } : x));
    });
  }, []);

  const toggleWantToTryFromList = useCallback((recipeId: number) => {
    setItems((prev) => {
      const it = prev.find((x) => x.id === recipeId);
      if (!it) return prev;
      const next = !it.wantToTry;

      void (async () => {
        try {
          await setRecipeWantToTryFlag(recipeId, next);
        } catch (e) {
          console.error(safeErrorMessage(e));
          setItems((p2) =>
            p2.map((x) => (x.id === recipeId ? { ...x, wantToTry: it.wantToTry } : x))
          );
          Alert.alert('Kon “Wil proberen” niet bijwerken.', 'Probeer het opnieuw.');
        }
      })();

      return prev.map((x) => (x.id === recipeId ? { ...x, wantToTry: next } : x));
    });
  }, []);

  const scrollSearchToTop = useCallback(() => {
    const target = Math.max(0, searchBlockY - 6);
    requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({ offset: target, animated: true });
      // Sometimes the keyboard shifts layout after first scroll.
      setTimeout(() => listRef.current?.scrollToOffset({ offset: target, animated: true }), 60);
    });
  }, [searchBlockY]);

  const secondaryFilterCount = useMemo(() => {
    let n = 0;
    if (maxTotalTimeMin != null) n++;
    if (categoryKey != null) n++;
    n += tagKeys.length;
    n += dietKeys.length;
    n += customDietKeys.length;
    return n;
  }, [maxTotalTimeMin, categoryKey, tagKeys.length, dietKeys.length, customDietKeys.length]);

  const hasActiveFilterStrip = secondaryFilterCount > 0;

  const clearFilters = useCallback(() => {
    setSearchQuery('');
    setCategoryKey(null);
    setTagKeys([]);
    setDietKeys([]);
    setCustomDietKeys([]);
    setTagsPickerOpen(false);
    setFavoritesOnly(false);
    setWantToTryOnly(false);
    setMaxTotalTimeMin(null);
    setInListId(null);
  }, []);

  const refresh = useCallback(() => {
    void (async () => {
      try {
        const [ls, cats, tags, diets] = await Promise.all([
          listAllLists(),
          listDistinctRecipeCategories(),
          listDistinctRecipeTags(),
          getCustomDiets(),
        ]);
        setLists(ls);
        setCategories(cats);
        setRecipeTags(tags);
        setCustomDiets(diets.map((d) => d.name));
        setTagKeys((prev) => prev.filter((t) => tags.includes(t)));
        setCustomDietKeys((prev) => prev.filter((d) => diets.some((x) => x.name === d)));
        setDataTick((t) => t + 1);
      } catch (e) {
        console.error(safeErrorMessage(e));
      }
    })();
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  const saveNewList = useCallback(() => {
    const n = newName.trim();
    if (!n) {
      Alert.alert('Naam verplicht', 'Geef de lijst een naam (bijv. Zomerrecepten).');
      return;
    }
    void (async () => {
      try {
        const id = await createList(n, newDesc.trim() || undefined);
        setModalOpen(false);
        setNewName('');
        setNewDesc('');
        refresh();
        router.push(`/list/${id}`);
      } catch (e) {
        Alert.alert('Fout', e instanceof Error ? e.message : 'Aanmaken mislukt.');
      }
    })();
  }, [newName, newDesc, refresh, router]);

  const listTilesGrid = (
    <View style={styles.tilesGrid}>
      {filteredLists.map((l, i) => {
        const pal = listBoxPalettes[i % listBoxPalettes.length];
        return (
          <Pressable
            key={l.id}
            style={[
              styles.listBox,
              { width: listTileWidth, backgroundColor: pal.bg, borderColor: pal.border },
            ]}
            onPress={() => router.push(`/list/${l.id}`)}
          >
            <Text style={[styles.listBoxTitle, { color: pal.text }]} numberOfLines={2}>
              {l.name}
            </Text>
            <Text style={styles.listBoxCount}>
              {l.recipeCount} recept{l.recipeCount === 1 ? '' : 'en'}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  const dietLabel = useCallback((k: string) => {
    if (k === 'vegetarian') return 'Vega';
    if (k === 'vegan') return 'Vegan';
    if (k === 'keto') return 'Keto';
    return k;
  }, []);

  const topBarRow = () => (
    <View style={styles.topBarRow}>
      <View style={styles.segmentOuter}>
        <View
          style={[styles.segmentTrack, { borderColor: theme.accentBorderMuted }]}
          onLayout={(e) => setSegmentWidth(e.nativeEvent.layout.width)}
        >
          <View style={styles.segmentTrackLabels} pointerEvents="none">
            <Text
              style={[styles.segmentTrackLabel, view === 'recepten' ? { color: '#1a1a1a' } : null]}
            >
              Recepten
            </Text>
            <Text
              style={[styles.segmentTrackLabel, view === 'lijsten' ? { color: '#1a1a1a' } : null]}
            >
              Lijsten
            </Text>
          </View>

          {segmentWidth > 0
            ? (() => {
                const inset = 3;
                const innerW = Math.max(0, segmentWidth - inset * 2);
                const thumbW = PixelRatio.roundToNearestPixel(innerW / 2);
                const rightX = PixelRatio.roundToNearestPixel(Math.max(0, innerW - thumbW));
                return (
                  <Animated.View
                    style={[
                      styles.segmentThumb,
                      {
                        backgroundColor: theme.accentSoft,
                        borderColor: theme.accent,
                        left: inset,
                        width: Math.max(40, thumbW),
                        transform: [
                          {
                            translateX: Animated.add(
                              segmentThumbT.interpolate({
                                inputRange: [0, 1],
                                outputRange: [0, rightX],
                              }),
                              swipeX.interpolate({
                                inputRange: [-160, 0, 160],
                                outputRange: [-10, 0, 10],
                                extrapolate: 'clamp',
                              })
                            ),
                          },
                        ],
                      },
                    ]}
                    pointerEvents="none"
                  />
                );
              })()
            : null}

          <View style={styles.segmentTapRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Toon recepten"
              accessibilityState={{ selected: view === 'recepten' }}
              style={styles.segmentTapHalf}
              onPress={() => setView('recepten')}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Toon lijsten"
              accessibilityState={{ selected: view === 'lijsten' }}
              style={styles.segmentTapHalf}
              onPress={() => setView('lijsten')}
            />
          </View>
        </View>
      </View>
      <View style={styles.headerBtnRow}>
        {view === 'recepten' ? (
          <>
            <Link href="/recipe/new" asChild>
              <Pressable
                style={StyleSheet.flatten([styles.headerBtn, { backgroundColor: theme.accent }])}
              >
                <Text style={styles.headerBtnText}>+ Nieuw</Text>
              </Pressable>
            </Link>
            <Link href="/recipe/import" asChild>
              <Pressable
                style={StyleSheet.flatten([styles.headerBtn, { backgroundColor: theme.accent }])}
              >
                <Text style={styles.headerBtnText}>Importeer</Text>
              </Pressable>
            </Link>
          </>
        ) : (
          <Pressable
            style={StyleSheet.flatten([styles.headerBtn, { backgroundColor: theme.accent }])}
            onPress={() => setModalOpen(true)}
          >
            <Text style={styles.headerBtnText}>+ Nieuwe lijst</Text>
          </Pressable>
        )}
      </View>
    </View>
  );

  const clearFiltersInModal = useCallback(() => {
    clearFilters();
    setFiltersModalOpen(false);
  }, [clearFilters]);

  const listHeader = useMemo(
    () => (
      <View style={styles.headerBlock}>
        {topBarRow()}

        <View
          style={styles.searchBlock}
          onLayout={(e) => {
            setSearchBlockY(e.nativeEvent.layout.y);
          }}
        >
          <View style={styles.searchInputWrap}>
            <TextInput
              style={styles.searchInput}
              placeholder="Zoek op titel, ingrediënt, stap, tag…"
              placeholderTextColor="#999"
              value={searchQuery}
              onChangeText={setSearchQuery}
              onFocus={scrollSearchToTop}
              autoCorrect={false}
              autoCapitalize="none"
              clearButtonMode="while-editing"
            />
            {searchQuery.length > 0 ? (
              <Pressable
                style={styles.searchClearBtn}
                onPress={() => setSearchQuery('')}
                accessibilityRole="button"
                accessibilityLabel="Zoekopdracht wissen"
                hitSlop={10}
              >
                <Ionicons name="close-circle" size={20} color="#999" />
              </Pressable>
            ) : null}
          </View>
        </View>

        <View style={styles.chipRowMain}>
          <View style={styles.chipRowLeft}>
            <Pressable
              style={[styles.chip, favoritesOnly ? chipOnStyle : null]}
              onPress={() => setFavoritesOnly((v) => !v)}
            >
              <Text style={[styles.chipText, favoritesOnly ? chipTextOnStyle : null]}>
                Favorieten
              </Text>
            </Pressable>
            <Pressable
              style={[styles.chip, wantToTryOnly ? chipOnStyle : null]}
              onPress={() => setWantToTryOnly((v) => !v)}
            >
              <Text style={[styles.chipText, wantToTryOnly ? chipTextOnStyle : null]}>
                Wil proberen
              </Text>
            </Pressable>
            <Pressable
              style={[styles.chip, discoveredIds ? chipOnStyle : null]}
              onPress={handleDiscover}
              disabled={searchQuery.length < 5 || searchQuery.length === 0 || discoverLoading}
            >
              {discoverLoading ? (
                <ActivityIndicator size="small" color={theme.accentSoftText} />
              ) : (
                <Text style={[styles.chipText, discoveredIds ? chipTextOnStyle : null]}>
                  Ontdek
                </Text>
              )}
            </Pressable>
          </View>
          <Pressable
            style={[
              styles.chip,
              styles.chipFilterBtn,
              secondaryFilterCount > 0
                ? { backgroundColor: theme.accentSoft, borderColor: theme.accent }
                : null,
            ]}
            onPress={() => setFiltersModalOpen(true)}
          >
            <Text
              style={[
                styles.chipText,
                secondaryFilterCount > 0 ? { color: theme.accentSoftText } : null,
              ]}
              numberOfLines={1}
            >
              {secondaryFilterCount > 0 ? `Filters · ${secondaryFilterCount}` : 'Filters'}
            </Text>
          </Pressable>
        </View>

        {hasActiveFilterStrip ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.filterStripScroll}
          >
            <View style={styles.chipRow}>
              {maxTotalTimeMin != null ? (
                <Pressable
                  style={[styles.chip, styles.activeFilterChip]}
                  onPress={() => setMaxTotalTimeMin(null)}
                >
                  <Text style={styles.chipText} numberOfLines={1}>
                    Max. {maxTotalTimeMin} min
                  </Text>
                  <Text style={styles.activeFilterClose}>✕</Text>
                </Pressable>
              ) : null}
              {dietKeys.map((k) => (
                <Pressable
                  key={`strip-diet-${k}`}
                  style={[styles.chip, styles.activeFilterChip]}
                  onPress={() => toggleDiet(k)}
                >
                  <Text style={styles.chipText} numberOfLines={1}>
                    {dietLabel(k)}
                  </Text>
                  <Text style={styles.activeFilterClose}>✕</Text>
                </Pressable>
              ))}
              {customDietKeys.map((name) => (
                <Pressable
                  key={`strip-cdiet-${name}`}
                  style={[styles.chip, styles.activeFilterChip]}
                  onPress={() => toggleCustomDiet(name)}
                >
                  <Text style={styles.chipText} numberOfLines={1}>
                    {name}
                  </Text>
                  <Text style={styles.activeFilterClose}>✕</Text>
                </Pressable>
              ))}
              {categoryKey != null ? (
                <Pressable
                  style={[styles.chip, styles.activeFilterChip]}
                  onPress={() => setCategoryKey(null)}
                >
                  <Text style={styles.chipText} numberOfLines={1}>
                    {categoryKey}
                  </Text>
                  <Text style={styles.activeFilterClose}>✕</Text>
                </Pressable>
              ) : null}
              {tagKeys.map((t) => (
                <Pressable
                  key={`strip-tag-${t}`}
                  style={[styles.chip, styles.activeFilterChip]}
                  onPress={() => toggleTag(t)}
                >
                  <Text style={styles.chipText} numberOfLines={1}>
                    {t}
                  </Text>
                  <Text style={styles.activeFilterClose}>✕</Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        ) : null}
      </View>
    ),
    [
      topBarRow,
      hasActiveFilterStrip,
      searchQuery,
      favoritesOnly,
      wantToTryOnly,
      theme,
      secondaryFilterCount,
      dietLabel,
      clearFilters,
      maxTotalTimeMin,
      dietKeys,
      customDietKeys,
      categoryKey,
      tagKeys,
      toggleDiet,
      toggleCustomDiet,
      setCategoryKey,
      toggleTag,
    ]
  );

  /** Check if any filters are active (search, category, tags, diets, etc.) */
  const hasAnyActiveFilters = useMemo(() => {
    return hasActiveFilterStrip || searchQuery.trim() !== '' || favoritesOnly || wantToTryOnly;
  }, [hasActiveFilterStrip, searchQuery, favoritesOnly, wantToTryOnly]);

  /** Render the recent opened recipe tile */
  const recentOpenedTile = useMemo(() => {
    if (!lastOpenedRecipe || hasAnyActiveFilters) return null;
    return (
      <View style={[styles.recentOpenedCard, { backgroundColor: theme.background }]}>
        <Text style={styles.recentOpenedLabel}>Recent geopend</Text>
        <Pressable
          style={styles.recentOpenedPress}
          onPress={() => router.push(`/recipe/${lastOpenedRecipe.id}`)}
        >
          <RecipeListThumb uri={lastOpenedRecipe.imageUri} size={64} />
          <View style={styles.recentOpenedTextCol}>
            <Text style={styles.recentOpenedTitle} numberOfLines={1}>
              {lastOpenedRecipe.title}
            </Text>
            {lastOpenedRecipe.category ? (
              <Text style={styles.recentOpenedCategory}>{lastOpenedRecipe.category}</Text>
            ) : null}
          </View>
        </Pressable>
      </View>
    );
  }, [lastOpenedRecipe, hasAnyActiveFilters, theme.background, router]);

  /** Combined header with recent opened tile at the top */
  const combinedListHeader = useMemo(
    () => (
      <>
        {recentOpenedTile}
        {listHeader}
      </>
    ),
    [recentOpenedTile, listHeader]
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <PanGestureHandler
        enabled={canSwipe}
        activeOffsetX={[-15, 15]}
        failOffsetY={[-10, 10]}
        onGestureEvent={Animated.event([{ nativeEvent: { translationX: swipeX } }], {
          useNativeDriver: false,
        })}
        onHandlerStateChange={onSwipeStateChange}
      >
        <View style={styles.container}>
          {view === 'lijsten' ? (
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.lijstenScroll}
            >
              <View style={styles.headerBlock}>
                {topBarRow()}
                <View style={styles.lijstenSearchBlock}>
                  <TextInput
                    style={styles.searchInput}
                    placeholder="Zoek lijsten…"
                    placeholderTextColor="#999"
                    value={listsQuery}
                    onChangeText={setListsQuery}
                    autoCorrect={false}
                    autoCapitalize="none"
                    clearButtonMode="while-editing"
                  />
                </View>
                {listTilesGrid}
                {listsQuery.trim() !== '' && filteredLists.length === 0 ? (
                  <Text style={styles.lijstenEmptyFilter}>Geen lijsten gevonden.</Text>
                ) : null}
              </View>
            </ScrollView>
          ) : (
            <FlatList
              ref={listRef}
              data={items}
              keyExtractor={(it) => String(it.id)}
              keyboardShouldPersistTaps="handled"
              ListHeaderComponent={combinedListHeader}
              contentContainerStyle={styles.listContent}
              ListEmptyComponent={
                <View style={styles.emptyWrap}>
                  <Text style={styles.empty}>
                    {totalRecipeCount === 0
                      ? 'Nog geen recepten. Tik op + Nieuw of Importeer om er een toe te voegen.'
                      : 'Geen recepten die voldoen aan je zoek- of filterkeuze. Pas je zoekwoorden of filters aan.'}
                  </Text>
                </View>
              }
              renderItem={({ item }) => (
                <View style={styles.card}>
                  <View style={styles.cardRow}>
                    <Pressable
                      style={styles.cardMainPress}
                      onPress={() => router.push(`/recipe/${item.id}`)}
                      onLongPress={() => setCardActionFor(item)}
                      delayLongPress={260}
                    >
                      <RecipeListThumb uri={item.imageUri} size={78} />
                      <View style={styles.cardTextCol}>
                        <Text style={styles.cardTitle} numberOfLines={2}>
                          {item.title}
                        </Text>
                        <View style={styles.cardMeta}>
                          {item.category ? (
                            <Text style={styles.cardSub}>{item.category}</Text>
                          ) : null}
                          {item.wantToTry ? (
                            <Text style={styles.tryBadge}>Wil proberen</Text>
                          ) : null}
                        </View>
                      </View>
                    </Pressable>

                    <View style={styles.cardRightCol}>
                      <Pressable
                        style={styles.favoriteBtn}
                        hitSlop={10}
                        onPress={() => toggleFavoriteFromList(item.id)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: item.isFavorite }}
                        accessibilityLabel={
                          item.isFavorite
                            ? 'Verwijderen uit favorieten'
                            : 'Toevoegen aan favorieten'
                        }
                      >
                        <Ionicons
                          name={item.isFavorite ? 'heart' : 'heart-outline'}
                          size={20}
                          color={item.isFavorite ? theme.accent : '#9a958d'}
                          accessibilityElementsHidden
                          importantForAccessibility="no"
                        />
                      </Pressable>

                      {item.bioScoreColor ? (
                        <Ionicons
                          name="leaf"
                          size={16}
                          color={
                            item.bioScoreColor === 'green'
                              ? '#2e7d32'
                              : item.bioScoreColor === 'red'
                                ? '#b00020'
                                : theme.accent
                          }
                          accessibilityLabel={
                            item.bioScoreColor === 'green'
                              ? 'Bio-score: groen'
                              : item.bioScoreColor === 'red'
                                ? 'Bio-score: rood'
                                : 'Bio-score: oranje'
                          }
                          accessibilityElementsHidden
                          importantForAccessibility="no"
                          style={styles.bioLeafUnderHeart}
                        />
                      ) : null}
                    </View>
                  </View>
                </View>
              )}
            />
          )}
        </View>
      </PanGestureHandler>

      <Modal
        visible={cardActionFor != null}
        animationType="fade"
        transparent
        onRequestClose={() => setCardActionFor(null)}
      >
        <View style={styles.sheetBackdrop}>
          <Pressable style={styles.sheetBackdropPress} onPress={() => setCardActionFor(null)} />
          <View style={[styles.cardActionsSheet, { backgroundColor: theme.background }]}>
            <Text style={styles.cardActionsTitle} numberOfLines={2}>
              {cardActionFor?.title ?? ''}
            </Text>

            <Pressable
              style={[styles.cardActionBtn, { backgroundColor: theme.accent }]}
              onPress={() => {
                const it = cardActionFor;
                if (!it) return;
                setCardActionFor(null);
                setTimeout(() => openQuickPlan(it), 0);
              }}
            >
              <Text style={styles.cardActionBtnText}>Zet in weekplanner…</Text>
            </Pressable>

            <Pressable
              style={styles.cardActionOutline}
              onPress={() => {
                const it = cardActionFor;
                if (!it) return;
                setCardActionFor(null);
                toggleWantToTryFromList(it.id);
              }}
            >
              <Text style={styles.cardActionOutlineText}>
                {cardActionFor?.wantToTry ? 'Niet meer proberen' : 'Wil proberen'}
              </Text>
            </Pressable>

            <Pressable
              style={styles.cardActionOutline}
              onPress={() => {
                const it = cardActionFor;
                if (!it) return;
                setCardActionFor(null);
                setListPickFor(it);
                void getRecipeListMembership(it.id)
                  .then(setListPickRows)
                  .catch(() => setListPickRows([]));
              }}
            >
              <Text style={[styles.cardActionOutlineText, { color: theme.accent }]}>
                Aan lijst koppelen…
              </Text>
            </Pressable>

            <Pressable
              style={styles.cardActionOutline}
              onPress={() => {
                const it = cardActionFor;
                if (!it) return;
                setCardActionFor(null);
                void (async () => {
                  const newId = await duplicateRecipe({ recipeId: it.id });
                  setDataTick((t) => t + 1);
                  router.push(`/recipe/${newId}`);
                })();
              }}
            >
              <Text style={styles.cardActionOutlineText}>Dupliceren</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={quickPlanFor != null}
        animationType="fade"
        transparent
        onRequestClose={() => (quickPlanBusy ? null : setQuickPlanFor(null))}
      >
        <View style={styles.sheetBackdrop}>
          <Pressable
            style={styles.sheetBackdropPress}
            onPress={() => (quickPlanBusy ? null : setQuickPlanFor(null))}
          />
          <View style={[styles.cardActionsSheet, { backgroundColor: theme.background }]}>
            <Text style={styles.cardActionsTitle} numberOfLines={1}>
              Zet in weekplanner
            </Text>
            <Text style={styles.cardActionsSub} numberOfLines={2}>
              {quickPlanFor?.title ?? ''}
            </Text>

            <ScrollView style={styles.quickPlanScroll} keyboardShouldPersistTaps="handled">
              {quickDates.map((d, i) => (
                <Pressable
                  key={d}
                  style={[
                    styles.quickPlanRow,
                    { borderColor: theme.accentBorderMuted },
                    quickPlanBusy && styles.quickPlanRowOff,
                  ]}
                  disabled={quickPlanBusy}
                  onPress={() => quickAddToDate(d)}
                >
                  <Text style={styles.quickPlanRowTitle}>{labelForIndex(i, d)}</Text>
                  <Text style={styles.quickPlanRowSub} numberOfLines={1}>
                    {quickPlanBusy ? 'Laden…' : (quickPlanPlannedTitleByDate[d] ?? '—')}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            <Pressable
              style={[
                styles.listPickClose,
                { backgroundColor: theme.accent },
                quickPlanBusy && styles.quickPlanRowOff,
              ]}
              onPress={() => setQuickPlanFor(null)}
              disabled={quickPlanBusy}
            >
              <Text style={styles.listPickCloseText}>Annuleren</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={listPickFor != null}
        animationType="fade"
        transparent
        onRequestClose={() => setListPickFor(null)}
      >
        <View style={styles.sheetBackdrop}>
          <Pressable style={styles.sheetBackdropPress} onPress={() => setListPickFor(null)} />
          <View style={[styles.cardActionsSheet, { backgroundColor: theme.background }]}>
            <Text style={styles.cardActionsTitle} numberOfLines={2}>
              Lijsten
            </Text>
            <Text style={styles.cardActionsSub} numberOfLines={2}>
              {listPickFor?.title ?? ''}
            </Text>
            <ScrollView style={styles.listPickScroll} keyboardShouldPersistTaps="handled">
              {listPickRows.length === 0 ? (
                <Text style={styles.listPickEmpty}>
                  Nog geen lijsten. Maak er eerst één via “Lijsten”.
                </Text>
              ) : (
                listPickRows.map((r) => (
                  <Pressable
                    key={r.id}
                    style={styles.listPickRow}
                    onPress={() => {
                      const it = listPickFor;
                      if (!it) return;
                      const next = !r.member;
                      setListPickRows((prev) =>
                        prev.map((x) => (x.id === r.id ? { ...x, member: next } : x))
                      );
                      void setRecipeInList(r.id, it.id, next);
                    }}
                  >
                    <Text style={styles.listPickCheck}>{r.member ? '✓' : '○'}</Text>
                    <Text style={styles.listPickText} numberOfLines={2}>
                      {r.name}
                    </Text>
                  </Pressable>
                ))
              )}
            </ScrollView>
            <Pressable
              style={[styles.listPickClose, { backgroundColor: theme.accent }]}
              onPress={() => setListPickFor(null)}
            >
              <Text style={styles.listPickCloseText}>Klaar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={filtersModalOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setFiltersModalOpen(false)}
      >
        <View style={styles.sheetBackdrop}>
          <Pressable style={styles.sheetBackdropPress} onPress={() => setFiltersModalOpen(false)} />
          <View style={styles.filtersSheet}>
            <Text style={styles.filtersSheetTitle}>Filters</Text>
            <ScrollView
              style={styles.filtersSheetScroll}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.filtersSheetScrollInner}
            >
              <Text style={styles.filterSubLabel}>Max. totale tijd (min.)</Text>
              <View style={styles.timeSliderRow}>
                <View style={styles.timeSliderCol}>
                  <Slider
                    style={styles.timeSlider}
                    minimumValue={10}
                    maximumValue={180}
                    step={5}
                    value={maxTotalTimeMin ?? 60}
                    minimumTrackTintColor={theme.accent}
                    maximumTrackTintColor="#e2ddd5"
                    thumbTintColor={theme.accent}
                    onValueChange={(v) => {
                      const next = Math.round(v / 5) * 5;
                      setMaxTotalTimeMin(next);
                    }}
                  />
                  <Text style={styles.timeSliderValue}>
                    {maxTotalTimeMin == null ? 'Geen maximum' : `Max. ${maxTotalTimeMin} min`}
                  </Text>
                </View>
                <Pressable
                  style={[
                    styles.timeSliderResetBtn,
                    maxTotalTimeMin == null ? styles.timeSliderResetBtnOff : null,
                  ]}
                  onPress={() => setMaxTotalTimeMin(null)}
                  disabled={maxTotalTimeMin == null}
                >
                  <Text
                    style={[
                      styles.timeSliderResetText,
                      maxTotalTimeMin == null ? styles.timeSliderResetTextOff : null,
                    ]}
                  >
                    Reset
                  </Text>
                </Pressable>
              </View>

              <Text style={styles.filterSubLabel}>Dieet</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.chipScroll}
              >
                <View style={styles.chipRow}>
                  <Pressable
                    style={[
                      styles.chip,
                      dietKeys.length === 0 && customDietKeys.length === 0 ? chipOnStyle : null,
                    ]}
                    onPress={() => {
                      clearDiet();
                      clearCustomDiets();
                    }}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        dietKeys.length === 0 && customDietKeys.length === 0
                          ? chipTextOnStyle
                          : null,
                      ]}
                    >
                      Alle
                    </Text>
                  </Pressable>
                  {['vegetarian', 'vegan', 'keto', ...customDiets].map((k) => {
                    const isBuiltIn = k === 'vegetarian' || k === 'vegan' || k === 'keto';
                    const on = isBuiltIn ? selectedDietSet.has(k) : selectedCustomDietSet.has(k);
                    const label =
                      k === 'vegetarian'
                        ? 'Vega'
                        : k === 'vegan'
                          ? 'Vegan'
                          : k === 'keto'
                            ? 'Keto'
                            : k;
                    return (
                      <Pressable
                        key={`diet-${k}`}
                        style={[styles.chip, on ? chipOnStyle : null]}
                        onPress={() => {
                          if (isBuiltIn) toggleDiet(k);
                          else toggleCustomDiet(k);
                        }}
                      >
                        <Text
                          style={[styles.chipText, on ? chipTextOnStyle : null]}
                          numberOfLines={1}
                        >
                          {label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </ScrollView>

              {categories.length > 0 ? (
                <>
                  <Text style={styles.filterSubLabel}>Categorie</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.chipScroll}
                  >
                    <View style={styles.chipRow}>
                      <Pressable
                        style={[styles.chip, categoryKey === null ? chipOnStyle : null]}
                        onPress={() => setCategoryKey(null)}
                      >
                        <Text
                          style={[styles.chipText, categoryKey === null ? chipTextOnStyle : null]}
                        >
                          Alle
                        </Text>
                      </Pressable>
                      {categories.map((c) => (
                        <Pressable
                          key={c}
                          style={[styles.chip, categoryKey === c ? chipOnStyle : null]}
                          onPress={() => setCategoryKey((cur) => (cur === c ? null : c))}
                        >
                          <Text
                            style={[styles.chipText, categoryKey === c ? chipTextOnStyle : null]}
                            numberOfLines={1}
                          >
                            {c}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </ScrollView>
                </>
              ) : null}

              {recipeTags.length > 0 ? (
                <>
                  <Text style={styles.filterSubLabel}>Tag</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.chipScroll}
                  >
                    <View style={styles.chipRow}>
                      <Pressable
                        style={[styles.chip, tagKeys.length === 0 ? chipOnStyle : null]}
                        onPress={clearTags}
                      >
                        <Text
                          style={[styles.chipText, tagKeys.length === 0 ? chipTextOnStyle : null]}
                        >
                          Alle
                        </Text>
                      </Pressable>
                      {tagKeys.map((t) => (
                        <Pressable
                          key={t}
                          style={[styles.chip, selectedTagSet.has(t) ? chipOnStyle : null]}
                          onPress={() => toggleTag(t)}
                        >
                          <Text
                            style={[
                              styles.chipText,
                              selectedTagSet.has(t) ? chipTextOnStyle : null,
                            ]}
                            numberOfLines={1}
                          >
                            {t}
                          </Text>
                        </Pressable>
                      ))}
                      {extraTags.length > 0 ? (
                        <Pressable
                          style={[
                            styles.chip,
                            styles.tagsMoreChip,
                            tagKeyInExtra ? chipOnStyle : null,
                          ]}
                          onPress={() => setTagsPickerOpen(true)}
                        >
                          <Text
                            style={[
                              styles.chipText,
                              styles.tagsMoreChipText,
                              tagKeyInExtra ? chipTextOnStyle : null,
                            ]}
                          >
                            + tags
                          </Text>
                        </Pressable>
                      ) : null}
                    </View>
                  </ScrollView>
                </>
              ) : null}
            </ScrollView>
            <View style={styles.filtersSheetActions}>
              <Pressable style={styles.filterClearAllBtn} onPress={clearFiltersInModal}>
                <Text style={styles.filterClearAllText}>Filters wissen</Text>
              </Pressable>
              <Pressable
                style={[styles.filterDoneBtn, { backgroundColor: theme.accent }]}
                onPress={() => setFiltersModalOpen(false)}
              >
                <Text style={styles.filterDoneBtnText}>Klaar</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={tagsPickerOpen}
        animationType="fade"
        transparent
        onRequestClose={() => setTagsPickerOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.tagPickerCard}>
            <Text style={styles.modalTitle}>Meer tags</Text>
            <Text style={styles.tagPickerHint}>Tik op een tag om daarop te filteren.</Text>
            <FlatList
              data={extraTags}
              numColumns={2}
              keyExtractor={(item) => item}
              style={styles.tagPickerList}
              columnWrapperStyle={styles.tagGridRow}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <Pressable
                  style={[styles.tagGridCell, selectedTagSet.has(item) ? chipOnStyle : null]}
                  onPress={() => {
                    toggleTag(item);
                  }}
                >
                  <Text
                    style={[
                      styles.tagGridCellText,
                      selectedTagSet.has(item) ? chipTextOnStyle : null,
                    ]}
                    numberOfLines={3}
                  >
                    {item}
                  </Text>
                </Pressable>
              )}
            />
            <Pressable style={styles.tagPickerCloseBtn} onPress={() => setTagsPickerOpen(false)}>
              <Text style={styles.tagPickerCloseBtnText}>Klaar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={modalOpen} animationType="fade" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Nieuwe lijst</Text>
            <Text style={styles.label}>Naam *</Text>
            <TextInput
              style={styles.input}
              placeholder="Bijv. Zomerrecepten"
              value={newName}
              onChangeText={setNewName}
            />
            <Text style={styles.label}>Omschrijving (optioneel)</Text>
            <TextInput
              style={[styles.input, styles.multiline]}
              placeholder="Wanneer gebruik je deze lijst?"
              value={newDesc}
              onChangeText={setNewDesc}
              multiline
            />
            <View style={styles.modalActions}>
              <Pressable style={styles.cancelBtn} onPress={() => setModalOpen(false)}>
                <Text style={styles.cancelBtnText}>Annuleren</Text>
              </Pressable>
              <Pressable
                style={[styles.saveModalBtn, { backgroundColor: theme.accent }]}
                onPress={saveNewList}
              >
                <Text style={styles.saveModalBtnText}>Aanmaken</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerBlock: { paddingBottom: 8 },
  topBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SCREEN_EDGE,
    marginTop: 10,
    marginBottom: 4,
    gap: 8,
    flexWrap: 'nowrap',
  },
  segmentOuter: { flexBasis: 190, flexGrow: 0, flexShrink: 1, maxWidth: 190, minWidth: 0 },
  segmentTrack: {
    width: '100%',
    height: 38,
    borderRadius: 999,
    borderWidth: 1,
    backgroundColor: '#fff',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  segmentTrackLabels: {
    position: 'absolute',
    left: 18,
    right: 18,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 2,
  },
  segmentTrackLabel: { fontSize: 13, fontWeight: '800', color: '#6b6b6b' },
  segmentTapRow: {
    flexDirection: 'row',
    height: '100%',
    width: '100%',
    zIndex: 3,
  },
  segmentTapHalf: { flex: 1 },
  segmentThumb: {
    position: 'absolute',
    top: 3,
    bottom: 3,
    borderRadius: 999,
    zIndex: 1,
  },
  lijstenScroll: { paddingBottom: 24, flexGrow: 1 },
  lijstenSearchBlock: { paddingHorizontal: SCREEN_EDGE, marginTop: 4, marginBottom: 4, gap: 8 },
  lijstenEmptyFilter: {
    fontSize: 14,
    color: '#888',
    textAlign: 'center',
    paddingVertical: 16,
    paddingHorizontal: SCREEN_EDGE,
  },
  headerBtnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
    flexShrink: 1,
    flexWrap: 'nowrap',
    minWidth: 0,
  },
  headerBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    flexShrink: 1,
    alignItems: 'center',
  },
  headerBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  listsSectionLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1a1a1a',
    paddingHorizontal: SCREEN_EDGE,
    marginTop: 12,
  },
  listsHint: {
    fontSize: 13,
    color: '#666',
    paddingHorizontal: SCREEN_EDGE,
    marginTop: 4,
    marginBottom: 10,
    lineHeight: 18,
  },
  tilesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: SCREEN_EDGE,
    paddingTop: 10,
    paddingBottom: 4,
    gap: TILE_GAP,
  },
  listBox: {
    minHeight: 104,
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 12,
    justifyContent: 'space-between',
  },
  listBoxTitle: { fontSize: 15, fontWeight: '700', lineHeight: 20 },
  listBoxCount: { fontSize: 12, color: '#666', marginTop: 6 },
  chipRowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: SCREEN_EDGE,
    marginBottom: 4,
  },
  chipRowLeft: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, flex: 1, minWidth: 0 },
  chipFilterBtn: { flexShrink: 0, marginLeft: 4 },
  filterStripScroll: { marginBottom: 4, maxHeight: 44 },
  activeFilterChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingRight: 10 },
  activeFilterClose: { fontSize: 12, color: '#666', fontWeight: '700' },
  searchBlock: { paddingHorizontal: SCREEN_EDGE, marginBottom: 8 },
  searchInput: {
    borderWidth: 1,
    borderColor: '#e2ddd5',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 16,
    backgroundColor: '#fff',
    color: '#1a1a1a',
    flex: 1,
  },
  searchInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  searchClearBtn: {
    paddingHorizontal: 8,
  },
  chipScroll: { marginBottom: 6 },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    gap: 8,
    paddingHorizontal: SCREEN_EDGE,
    paddingVertical: 4,
    alignItems: 'center',
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#e2ddd5',
    backgroundColor: '#fff',
  },
  chipText: { fontSize: 13, color: '#444', fontWeight: '600' },
  filterSubLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
    paddingHorizontal: SCREEN_EDGE,
    marginTop: 4,
    marginBottom: 2,
  },
  timeSliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: SCREEN_EDGE,
    paddingTop: 4,
    paddingBottom: 10,
  },
  timeSliderCol: { flex: 1, minWidth: 0 },
  timeSlider: { width: '100%', height: 36 },
  timeSliderValue: { fontSize: 12, color: '#666', fontWeight: '600', marginTop: -2 },
  timeSliderResetBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#e2ddd5',
    backgroundColor: '#fff',
  },
  timeSliderResetBtnOff: {
    backgroundColor: '#f7f6f3',
    borderColor: '#eee9e1',
  },
  timeSliderResetText: { fontSize: 13, color: '#444', fontWeight: '700' },
  timeSliderResetTextOff: { color: '#9a958d' },
  /** Altijd `flexGrow`: voorkomt verspringen wanneer filters de lijst leeg maken of vullen. */
  listContent: { flexGrow: 1, paddingBottom: 24 },
  emptyWrap: { paddingHorizontal: SCREEN_EDGE, paddingVertical: 32 },
  empty: { fontSize: 15, color: '#666', textAlign: 'center', paddingHorizontal: 8 },
  card: {
    marginHorizontal: SCREEN_EDGE,
    marginBottom: 6,
    padding: 8,
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2ddd5',
  },
  cardRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  cardMainPress: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  cardTextCol: { flex: 1, minWidth: 0 },
  cardTitle: { fontSize: 17, fontWeight: '600', color: '#1a1a1a' },
  cardMeta: { flexDirection: 'row', gap: 8, marginTop: 6, flexWrap: 'wrap' },
  cardSub: { fontSize: 14, color: '#666' },
  fav: { fontSize: 13, fontWeight: '600' },
  tryBadge: { fontSize: 13, color: '#2a4a7a', fontWeight: '600' },
  favoriteBtn: { paddingLeft: 6, paddingTop: 2 },
  cardRightCol: { alignItems: 'center', gap: 6, paddingTop: 2 },
  bioLeafUnderHeart: { marginLeft: 6 },
  favoriteHeart: { fontSize: 18, fontWeight: '800' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
  },
  modalTitle: { fontSize: 20, fontWeight: '700', marginBottom: 12 },
  label: { fontSize: 13, fontWeight: '600', color: '#444', marginTop: 8, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: '#e2ddd5',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  multiline: { minHeight: 72, textAlignVertical: 'top' },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 16, marginTop: 20 },
  cancelBtn: { paddingVertical: 10, paddingHorizontal: 8 },
  cancelBtnText: { color: '#666', fontSize: 16 },
  saveModalBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  saveModalBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  tagsMoreChip: {
    borderStyle: 'dashed',
    borderColor: '#c9c2b8',
  },
  tagsMoreChipText: { fontWeight: '700' },
  tagPickerCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    maxHeight: '88%',
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
  },
  tagPickerHint: { fontSize: 13, color: '#666', marginBottom: 12 },
  tagPickerList: { flexGrow: 0 },
  tagGridRow: { gap: 8, marginBottom: 8 },
  tagGridCell: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2ddd5',
    backgroundColor: '#fff',
    marginHorizontal: 4,
    minHeight: 48,
    justifyContent: 'center',
  },
  tagGridCellText: { fontSize: 14, color: '#333', fontWeight: '600', textAlign: 'center' },
  tagPickerCloseBtn: {
    marginTop: 12,
    alignSelf: 'center',
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  tagPickerCloseBtnText: { fontSize: 16, color: '#666', fontWeight: '600' },
  sheetBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheetBackdropPress: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  cardActionsSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '85%',
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 20,
    zIndex: 1,
    elevation: 4,
    borderWidth: 1,
    borderColor: '#e2ddd5',
  },
  cardActionsTitle: { fontSize: 18, fontWeight: '800', color: '#1a1a1a', marginBottom: 10 },
  cardActionsSub: { fontSize: 13, color: '#666', marginTop: -6, marginBottom: 10, lineHeight: 18 },
  cardActionBtn: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  cardActionBtnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  cardActionOutline: {
    marginTop: 10,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2ddd5',
    backgroundColor: '#fff',
    alignItems: 'center',
  },
  cardActionOutlineText: { fontWeight: '800', fontSize: 16, color: '#1a1a1a' },
  listPickScroll: { maxHeight: 360 },
  listPickEmpty: { fontSize: 14, color: '#666', lineHeight: 20, marginBottom: 8 },
  listPickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#e8e4dc',
  },
  listPickCheck: { fontSize: 20, width: 28, textAlign: 'center', color: '#1a1a1a' },
  listPickText: { flex: 1, fontSize: 16, color: '#1a1a1a' },
  listPickClose: {
    marginTop: 16,
    alignSelf: 'flex-end',
    paddingVertical: 12,
    paddingHorizontal: 22,
    borderRadius: 10,
  },
  listPickCloseText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  quickPlanScroll: { maxHeight: 420 },
  quickPlanRow: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    backgroundColor: '#fff',
    marginBottom: 8,
  },
  quickPlanRowOff: { opacity: 0.55 },
  quickPlanRowTitle: { fontSize: 15, fontWeight: '800', color: '#1a1a1a' },
  quickPlanRowSub: { fontSize: 13, color: '#666', marginTop: 2 },
  filtersSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '85%',
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 20,
    zIndex: 1,
    elevation: 4,
  },
  filtersSheetTitle: { fontSize: 20, fontWeight: '800', color: '#1a1a1a', marginBottom: 4 },
  filtersSheetScroll: { maxHeight: 480 },
  filtersSheetScrollInner: { paddingBottom: 8 },
  filtersSheetActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 12,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e2ddd5',
  },
  filterClearAllBtn: { paddingVertical: 12, paddingHorizontal: 8, flex: 1 },
  filterClearAllText: { color: '#9a3d3d', fontWeight: '700', fontSize: 16, textAlign: 'center' },
  filterDoneBtn: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 10,
    minWidth: 120,
    alignItems: 'center',
  },
  filterDoneBtnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  // Recent opened recipe tile styles
  recentOpenedCard: {
    paddingHorizontal: SCREEN_EDGE,
    paddingTop: 12,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e2ddd5',
  },
  recentOpenedLabel: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    color: '#666',
  },
  recentOpenedPress: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2ddd5',
  },
  recentOpenedTextCol: {
    flex: 1,
    minWidth: 0,
  },
  recentOpenedTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  recentOpenedCategory: {
    fontSize: 13,
    marginTop: 2,
    color: '#666',
  },
  chipDisabled: {
    opacity: 0.5,
  },
});
