import { useFocusEffect , useLocalSearchParams, useRouter } from 'expo-router';
import Slider from '@react-native-community/slider';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  LayoutAnimation,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MaterialIcons } from '@expo/vector-icons';

import { useConfirmDialog } from '../../components/ConfirmDialog';
import { useAppTheme } from '../../components/ThemeContext';
import { callAiText, hasActiveAiKey } from '../../lib/aiClient';
import {
  buildAiRepairUserPrompt,
  buildWeekPlanSystemPrompt,
  buildWeekPlanUserPrompt,
  WEEK_PLAN_OUTPUT_SCHEMA,
} from '../../lib/aiPromptTemplates';
import { getAiCookProfile, hydrateAiCookProfileFromDb } from '../../lib/aiCookProfile';
import { ensureDatabaseAsync } from '../../lib/db';
import { safeErrorMessage } from '../../lib/logSafe';
import { getCustomDiets } from '../../lib/dietPrefs';
import { parseExtractedRecipeJson } from '../../lib/recipeExtract';
import { aggregateShoppingFromWeekPlans } from '../../lib/shopping';
import { clearWeekShoppingItems, insertWeekShoppingItems } from '../../lib/shoppingRepo';
import {
  countRecipes,
  createRecipe,
  getFullRecipe,
  listDistinctRecipeCategories,
  listDistinctRecipeTags,
  listRecipes,
  listRecipesForWeekPlanningPrompt,
  MAX_RECIPES_IN_WEEK_PLAN_PROMPT,
  searchRecipes,
  type RecipeBrowseFilters,
} from '../../lib/recipesRepo';
import type { FullRecipe, RecipeListItem, RecipeSavePayload } from '../../lib/types';
import {
  getShoppingStaplesExcludeList,
  hydrateShoppingStaplesPrefsFromDb,
} from '../../lib/shoppingStaplesPrefs';
import {
  addDays,
  deleteWeekPlanByDate,
  deleteWeekPlansBetween,
  formatDateDdMmYyyy,
  listWeekPlansBetween,
  toIsoDateOnly,
  upsertWeekPlan,
} from '../../lib/weekPlansRepo';

function isRecord(x: unknown): x is Record<string, unknown> {
  return x != null && typeof x === 'object' && !Array.isArray(x);
}

function clampInt(n: unknown, lo: number, hi: number, fallback: number): number {
  const v = typeof n === 'number' ? n : Number.parseInt(String(n ?? ''), 10);
  if (!Number.isFinite(v)) return fallback;
  const r = Math.round(v);
  return Math.max(lo, Math.min(hi, r));
}

function dateOnlyToMs(dateOnly: string): number {
  const [y, m, d] = (dateOnly ?? '').split('-').map((x) => Number.parseInt(x, 10));
  return new Date(y, (m ?? 1) - 1, d ?? 1).getTime();
}

function diffDays(a: string, b: string): number {
  return Math.round((dateOnlyToMs(a) - dateOnlyToMs(b)) / (24 * 60 * 60 * 1000));
}

export default function PlannerScreen() {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { confirm, ConfirmDialog } = useConfirmDialog();
  const { recipeId: recipeIdParam } = useLocalSearchParams<{ recipeId?: string }>();
  const quickRecipeId = Number.parseInt(String(recipeIdParam ?? ''), 10);

  const today = useMemo(() => toIsoDateOnly(new Date()), []);
  const startDate = today;
  const endDate = useMemo(() => addDays(today, 6), [today]);
  const dates = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(startDate, i)),
    [startDate]
  );

  const [recipes, setRecipes] = useState<RecipeListItem[]>([]);
  const [plansByDate, setPlansByDate] = useState<
    Record<
      string,
      {
        recipeId: number;
        servings: number;
        cooksForDays: number;
        leftoverOfDate?: string | null;
      }
    >
  >({});
  const [loading, setLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const [pickerCategories, setPickerCategories] = useState<string[]>([]);
  const [pickerRecipeTags, setPickerRecipeTags] = useState<string[]>([]);
  const [pickerCustomDiets, setPickerCustomDiets] = useState<string[]>([]);
  const [pickerCategoryKey, setPickerCategoryKey] = useState<string | null>(null);
  const [pickerTagKeys, setPickerTagKeys] = useState<string[]>([]);
  const [pickerDietKeys, setPickerDietKeys] = useState<string[]>([]);
  const [pickerCustomDietKeys, setPickerCustomDietKeys] = useState<string[]>([]);
  const [pickerFavoritesOnly, setPickerFavoritesOnly] = useState(false);
  const [pickerWantToTryOnly, setPickerWantToTryOnly] = useState(false);
  const [pickerMaxTotalTimeMin, setPickerMaxTotalTimeMin] = useState<number | null>(null);
  const [pickerFiltersModalOpen, setPickerFiltersModalOpen] = useState(false);
  const [pickerTagsPickerOpen, setPickerTagsPickerOpen] = useState(false);
  const [pickerItems, setPickerItems] = useState<RecipeListItem[]>([]);
  const [pickerBusy, setPickerBusy] = useState(false);
  const [busyExport, setBusyExport] = useState(false);
  const [busyGenerate, setBusyGenerate] = useState(false);
  const [wishesText, setWishesText] = useState('');
  const [busyClear, setBusyClear] = useState(false);
  const [defaultServings, setDefaultServings] = useState(2);
  const [pendingNewByDate, setPendingNewByDate] = useState<
    Record<
      string,
      {
        tempId: string;
        title: string;
        recipeJsonText: string;
        servings: number;
        cooksForDays: number;
        leftoverOfDate: string | null;
      }
    >
  >({});
  const [pendingLeftoverOfDateByDate, setPendingLeftoverOfDateByDate] = useState<
    Record<string, string>
  >({});
  const [pendingReplaceOpen, setPendingReplaceOpen] = useState(false);
  const [pendingReplaceDate, setPendingReplaceDate] = useState<string | null>(null);
  const [pendingReplaceText, setPendingReplaceText] = useState('');
  const [busyReplace, setBusyReplace] = useState(false);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewDate, setPreviewDate] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewRecipeId, setPreviewRecipeId] = useState<number | null>(null);
  const [previewTitle, setPreviewTitle] = useState('');
  const [previewImageUri, setPreviewImageUri] = useState<string | null>(null);
  const [previewIngredients, setPreviewIngredients] = useState<
    RecipeSavePayload['ingredientGroups']
  >([]);
  const [previewSteps, setPreviewSteps] = useState<RecipeSavePayload['stepSections']>([]);
  const [previewServings, setPreviewServings] = useState<number>(2);
  const previewReqIdRef = useRef(0);
  const [generateSheetOpen, setGenerateSheetOpen] = useState(false);
  const [overflowMenuOpen, setOverflowMenuOpen] = useState(false);
  const [expandedByDate, setExpandedByDate] = useState<Record<string, boolean>>({});
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [weekPlanRecipeLibraryCount, setWeekPlanRecipeLibraryCount] = useState(0);

  const toggleExpandedForDate = useCallback((date: string) => {
    setExpandedByDate((prev) => ({ ...prev, [date]: !prev[date] }));
  }, []);

  // In-session memory of AI suggestions to avoid repeating the same 2 recipes
  // when the user taps "generate" multiple times in a row.
  const sessionSuggestedCookingRecipeIdsRef = useRef<Set<number>>(new Set());

  const [selectedByDate, setSelectedByDate] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const d of Array.from({ length: 7 }, (_, i) => addDays(toIsoDateOnly(new Date()), i)))
      init[d] = false;
    return init;
  });

  const recipeById = useMemo(() => {
    const m = new Map<number, RecipeListItem>();
    for (const r of recipes) m.set(r.id, r);
    return m;
  }, [recipes]);

  const reload = useCallback(() => {
    void (async () => {
      setLoading(true);
      try {
        await ensureDatabaseAsync();
        await hydrateAiCookProfileFromDb();
        setDefaultServings(getAiCookProfile().defaultServings ?? 2);

        const [rs, rows, recipeTotal] = await Promise.all([
          listRecipes(),
          listWeekPlansBetween(startDate, endDate),
          countRecipes(),
        ]);
        setRecipes(rs);
        setWeekPlanRecipeLibraryCount(recipeTotal);
        const next: Record<
          string,
          {
            recipeId: number;
            servings: number;
            cooksForDays: number;
            leftoverOfDate?: string | null;
          }
        > = {};
        for (const r of rows) {
          next[r.date] = {
            recipeId: r.recipeId,
            servings: r.servings,
            cooksForDays: r.cooksForDays,
            leftoverOfDate: r.leftoverOfDate,
          };
        }
        setPlansByDate(next);

        // Ensure selectedByDate always contains the current week range.
        setSelectedByDate((prev) => {
          const out: Record<string, boolean> = { ...prev };
          for (const d of dates) {
            if (out[d] === undefined) out[d] = false;
          }
          // Remove stale keys to keep it tidy.
          for (const k of Object.keys(out)) {
            if (!dates.includes(k)) delete out[k];
          }
          return out;
        });
      } finally {
        setLoading(false);
      }
    })();
  }, [dates, endDate, startDate]);

  const quickRecipeTitle = useMemo(() => {
    if (!Number.isFinite(quickRecipeId) || quickRecipeId <= 0) return null;
    const r = recipes.find((x) => x.id === quickRecipeId);
    return r?.title ?? 'Recept';
  }, [quickRecipeId, recipes]);

  const plannedTitleByDate = useMemo(() => {
    const out: Record<string, string> = {};
    for (const d of dates) {
      const p = plansByDate[d] ?? null;
      if (!p) {
        out[d] = '— leeg —';
        continue;
      }
      const isLeftover = (p.leftoverOfDate ?? null) != null;
      if (isLeftover) {
        const src = p.leftoverOfDate ?? '';
        const srcPlan = plansByDate[src] ?? null;
        const srcRecipeId = srcPlan?.recipeId ?? p.recipeId;
        const t = recipeById.get(srcRecipeId)?.title ?? 'Onbekend recept';
        out[d] = `Restjes: ${t}`;
        continue;
      }
      const t = recipeById.get(p.recipeId)?.title ?? 'Onbekend recept';
      out[d] = t;
    }
    return out;
  }, [dates, plansByDate, recipeById]);

  const clearQuickAddParam = useCallback(() => {
    setQuickAddOpen(false);
    router.replace('/planner');
  }, [router]);

  useFocusEffect(
    useCallback(() => {
      if (Number.isFinite(quickRecipeId) && quickRecipeId > 0) {
        setQuickAddOpen(true);
      }
    }, [quickRecipeId])
  );

  const quickAddToDate = useCallback(
    (date: string) => {
      if (!Number.isFinite(quickRecipeId) || quickRecipeId <= 0) return;
      void (async () => {
        // Initialize with defaults if empty, then persist.
        setPlansByDate((prev) => ({
          ...prev,
          [date]: {
            recipeId: quickRecipeId,
            servings: prev[date]?.servings ?? defaultServings,
            cooksForDays: prev[date]?.cooksForDays ?? 1,
            leftoverOfDate: null,
          },
        }));
        const servings = plansByDate[date]?.servings ?? defaultServings;
        await upsertWeekPlan({
          date,
          recipeId: quickRecipeId,
          servings,
          cooksForDays: plansByDate[date]?.cooksForDays ?? 1,
          leftoverOfDate: null,
        });
        reload();
        clearQuickAddParam();
      })();
    },
    [clearQuickAddParam, defaultServings, plansByDate, quickRecipeId, reload]
  );

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  const openPickerForDate = useCallback((date: string) => {
    setActiveDate(date);
    setPickerQuery('');
    // Keep current filters, but ensure all picker-related sheets are closed.
    setPickerFiltersModalOpen(false);
    setPickerTagsPickerOpen(false);
    setPickerOpen(true);
  }, []);

  const pickerSelectedTagSet = useMemo(() => new Set<string>(pickerTagKeys), [pickerTagKeys]);
  const pickerSelectedDietSet = useMemo(() => new Set<string>(pickerDietKeys), [pickerDietKeys]);
  const pickerSelectedCustomDietSet = useMemo(
    () => new Set<string>(pickerCustomDietKeys),
    [pickerCustomDietKeys]
  );

  const togglePickerTag = useCallback((t: string) => {
    setPickerTagKeys((prev) => {
      const s = new Set(prev);
      if (s.has(t)) s.delete(t);
      else s.add(t);
      return Array.from(s);
    });
  }, []);
  const clearPickerTags = useCallback(() => setPickerTagKeys([]), []);

  const togglePickerDiet = useCallback((k: string) => {
    setPickerDietKeys((prev) => {
      const s = new Set(prev);
      if (s.has(k)) s.delete(k);
      else s.add(k);
      return Array.from(s);
    });
  }, []);
  const clearPickerDiet = useCallback(() => setPickerDietKeys([]), []);

  const togglePickerCustomDiet = useCallback((name: string) => {
    setPickerCustomDietKeys((prev) => {
      const s = new Set(prev);
      if (s.has(name)) s.delete(name);
      else s.add(name);
      return Array.from(s);
    });
  }, []);
  const clearPickerCustomDiets = useCallback(() => setPickerCustomDietKeys([]), []);

  const pickerSecondaryFilterCount = useMemo(() => {
    let n = 0;
    if (pickerMaxTotalTimeMin != null) n++;
    if (pickerCategoryKey != null) n++;
    n += pickerTagKeys.length;
    n += pickerDietKeys.length;
    n += pickerCustomDietKeys.length;
    return n;
  }, [
    pickerMaxTotalTimeMin,
    pickerCategoryKey,
    pickerTagKeys.length,
    pickerDietKeys.length,
    pickerCustomDietKeys.length,
  ]);

  const pickerChipOnStyle = useMemo(
    () => ({ backgroundColor: theme.accentSoft, borderColor: theme.accent }),
    [theme.accentSoft, theme.accent]
  );
  const pickerChipTextOnStyle = useMemo(
    () => ({ color: theme.accentSoftText }),
    [theme.accentSoftText]
  );

  const pickerBrowseFilters = useMemo(
    (): RecipeBrowseFilters => ({
      query: pickerQuery,
      category: pickerCategoryKey,
      tagNames: pickerTagKeys,
      dietKeys: pickerDietKeys,
      customDietNames: pickerCustomDietKeys,
      favoritesOnly: pickerFavoritesOnly,
      wantToTryOnly: pickerWantToTryOnly,
      maxTotalTimeMin: pickerMaxTotalTimeMin,
      inListId: null,
    }),
    [
      pickerQuery,
      pickerCategoryKey,
      pickerTagKeys,
      pickerDietKeys,
      pickerCustomDietKeys,
      pickerFavoritesOnly,
      pickerWantToTryOnly,
      pickerMaxTotalTimeMin,
    ]
  );

  const closePickerSheets = useCallback(() => {
    setPickerFiltersModalOpen(false);
    setPickerTagsPickerOpen(false);
  }, []);

  const clearPickerFilters = useCallback(() => {
    setPickerQuery('');
    setPickerCategoryKey(null);
    setPickerTagKeys([]);
    setPickerDietKeys([]);
    setPickerCustomDietKeys([]);
    setPickerFavoritesOnly(false);
    setPickerWantToTryOnly(false);
    setPickerMaxTotalTimeMin(null);
    closePickerSheets();
  }, [closePickerSheets]);

  const pickerExtraTags = pickerRecipeTags;
  const pickerTagKeyInExtra = pickerTagKeys.length > 0;

  // Load picker filter options when opening the picker (kept local to avoid slowing down the main screen).
  useEffect(() => {
    if (!pickerOpen) return;
    let cancelled = false;
    void (async () => {
      try {
        await ensureDatabaseAsync();
        const [cats, tags, diets] = await Promise.all([
          listDistinctRecipeCategories(),
          listDistinctRecipeTags(),
          getCustomDiets(),
        ]);
        if (cancelled) return;
        setPickerCategories(cats);
        setPickerRecipeTags(tags);
        setPickerCustomDiets(diets.map((d) => d.name));
        setPickerTagKeys((prev) => prev.filter((t) => tags.includes(t)));
        setPickerCustomDietKeys((prev) => prev.filter((d) => diets.some((x) => x.name === d)));
      } catch (e) {
        console.error(safeErrorMessage(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pickerOpen]);

  // Search recipes for the picker whenever the picker is open and filters change.
  useEffect(() => {
    if (!pickerOpen) return;
    let cancelled = false;
    setPickerBusy(true);
    void (async () => {
      try {
        await ensureDatabaseAsync();
        const rows = await searchRecipes(pickerBrowseFilters);
        if (!cancelled) setPickerItems(rows);
      } catch (e) {
        console.error(safeErrorMessage(e));
      } finally {
        if (!cancelled) setPickerBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pickerBrowseFilters, pickerOpen]);

  const syncLeftoversForCookDate = useCallback(
    async (cookDate: string, recipeId: number, servings: number) => {
      const leftoverDates = Object.entries(plansByDate)
        .filter(([, p]) => (p?.leftoverOfDate ?? null) === cookDate)
        .map(([d]) => d);
      if (leftoverDates.length === 0) return;

      // Update DB first (so reload stays consistent).
      for (const d of leftoverDates) {
        await upsertWeekPlan({
          date: d,
          recipeId,
          servings,
          cooksForDays: 1,
          leftoverOfDate: cookDate,
        });
      }

      // Update local state immediately for snappy UI.
      setPlansByDate((prev) => {
        const out = { ...prev };
        for (const d of leftoverDates) {
          const lp = out[d];
          if (!lp) continue;
          out[d] = { ...lp, recipeId, servings, cooksForDays: 1, leftoverOfDate: cookDate };
        }
        return out;
      });
    },
    [plansByDate]
  );

  const closeRecipePreview = useCallback(() => {
    previewReqIdRef.current += 1;
    setPreviewOpen(false);
    setPreviewLoading(false);
    setPreviewDate(null);
    setPreviewError(null);
    setPreviewRecipeId(null);
  }, []);

  const openRecipePreview = useCallback(
    (date: string) => {
      const plan = plansByDate[date] ?? null;
      const pendingNew = pendingNewByDate[date] ?? null;
      const pendingLeftoverSrc = pendingLeftoverOfDateByDate[date] ?? null;
      const cookDateForPendingLeftover = pendingLeftoverSrc ?? plan?.leftoverOfDate ?? null;
      const pendingCook =
        !pendingNew && cookDateForPendingLeftover
          ? (pendingNewByDate[cookDateForPendingLeftover] ?? null)
          : null;

      const servings =
        plan?.servings ?? pendingNew?.servings ?? pendingCook?.servings ?? defaultServings;
      const reqId = (previewReqIdRef.current += 1);

      setPreviewDate(date);
      setPreviewError(null);
      setPreviewTitle('');
      setPreviewImageUri(null);
      setPreviewIngredients([]);
      setPreviewSteps([]);
      setPreviewServings(servings);
      setPreviewRecipeId(plan?.recipeId ?? null);
      setPreviewOpen(true);
      setPreviewLoading(true);

      const applyIfCurrent = (fn: () => void) => {
        if (previewReqIdRef.current !== reqId) return;
        fn();
      };

      const finishPreviewLoad = (error?: string) => {
        if (previewReqIdRef.current !== reqId) return;
        if (error) setPreviewError(error);
        setPreviewLoading(false);
      };

      void (async () => {
        try {
          await Promise.race([
            (async () => {
              await ensureDatabaseAsync();

              if (pendingNew || pendingCook) {
                applyIfCurrent(() => setPreviewRecipeId(null));
                const src = pendingNew ?? pendingCook;
                if (!src) throw new Error('Kon preview niet opbouwen.');
                const parsed = parseExtractedRecipeJson(src.recipeJsonText, '');
                if (!parsed.ok) throw new Error(parsed.reason);
                const p = parsed.payload;
                applyIfCurrent(() => {
                  setPreviewTitle(p.title.trim() || 'Nieuw recept');
                  setPreviewImageUri((p.imageUri ?? '').trim() || null);
                  setPreviewIngredients(p.ingredientGroups);
                  setPreviewSteps(p.stepSections);
                });
                return;
              }

              if (!plan) throw new Error('Kon preview niet opbouwen.');
              const full: FullRecipe | null = await getFullRecipe(plan.recipeId);
              if (!full) throw new Error('Recept niet gevonden.');
              applyIfCurrent(() => {
                setPreviewTitle(full.title);
                setPreviewImageUri(full.imageUri);
                setPreviewIngredients(
                  full.ingredientGroups.map((g) => ({
                    title: g.title ?? '',
                    ingredients: g.ingredients.map((i) => ({
                      name: i.name,
                      amount: i.amount,
                      unit: i.unit,
                    })),
                  }))
                );
                setPreviewSteps(
                  full.stepSections.map((s) => ({
                    title: s.title ?? '',
                    steps: s.steps.map((st) => ({
                      description: st.description,
                      timerSeconds: st.timerSeconds,
                    })),
                  }))
                );
              });
            })(),
            new Promise<never>((_, reject) =>
              setTimeout(
                () => reject(new Error('Preview laden duurt te lang. Probeer opnieuw.')),
                8000
              )
            ),
          ]);
        } catch (e) {
          finishPreviewLoad(e instanceof Error ? e.message : 'Onbekende fout.');
          return;
        }
        finishPreviewLoad();
      })();
    },
    [defaultServings, pendingLeftoverOfDateByDate, pendingNewByDate, plansByDate]
  );

  const filteredRecipes = useMemo(() => pickerItems, [pickerItems]);

  const persistPlan = useCallback(
    (params: {
      date: string;
      recipeId: number;
      servings: number;
      cooksForDays: number;
      leftoverOfDate?: string | null;
    }) => {
      void (async () => {
        await upsertWeekPlan({
          date: params.date,
          recipeId: params.recipeId,
          servings: Math.max(1, Math.min(99, Math.round(params.servings))),
          cooksForDays: Math.max(1, Math.min(7, Math.round(params.cooksForDays))),
          leftoverOfDate: params.leftoverOfDate ?? null,
        });
      })();
    },
    []
  );

  const leftoversForDate = useCallback(
    (
      date: string
    ): { sourceDate: string; recipeId: number; title: string; servings: number }[] => {
      const out: { sourceDate: string; recipeId: number; title: string; servings: number }[] =
        [];
      for (const [sourceDate, plan] of Object.entries(plansByDate)) {
        if (!plan) continue;
        if ((plan.leftoverOfDate ?? null) != null) continue; // restjes-dagen genereren zelf geen restjes
        if (plan.cooksForDays <= 1) continue;
        if (sourceDate >= date) continue;

        const recipe = recipeById.get(plan.recipeId);
        const title = recipe?.title?.trim() || '';
        if (!title) continue;
        out.push({ sourceDate, recipeId: plan.recipeId, title, servings: plan.servings });
      }
      // Nieuwste kookdag eerst (meestal meest logisch).
      out.sort((a, b) => b.sourceDate.localeCompare(a.sourceDate, 'nl'));
      return out;
    },
    [plansByDate, recipeById]
  );

  const removePlan = useCallback(
    (date: string) => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      // Optimistic UI: remove immediately, then persist.
      setPlansByDate((prev) => {
        const out = { ...prev };
        delete out[date];
        return out;
      });
      void (async () => {
        await deleteWeekPlanByDate(date);
        reload();
      })();
    },
    [reload]
  );

  const exportToShopping = useCallback(() => {
    if (busyExport) return;
    void (async () => {
      setBusyExport(true);
      try {
        await ensureDatabaseAsync();
        await hydrateShoppingStaplesPrefsFromDb();
        const plans = await listWeekPlansBetween(startDate, endDate);
        if (plans.length === 0) {
          Alert.alert(
            'Geen planning',
            'Plan eerst één of meer dagen voordat je de boodschappenlijst vult.'
          );
          return;
        }
        const staplesExclude = getShoppingStaplesExcludeList();
        const agg = await aggregateShoppingFromWeekPlans({ plans, staplesExclude });
        if (agg.length === 0) {
          Alert.alert(
            'Niets om toe te voegen',
            'Er zijn geen boodschappen gevonden (mogelijk door de uitsluitlijst).'
          );
          return;
        }

        const ok = await confirm({
          title: 'Op boodschappenlijstje zetten?',
          message:
            'Dit vervangt alleen de “week”-items op je boodschappenlijst. Handmatige items blijven staan.',
          confirmText: 'Zet erop',
          cancelText: 'Annuleren',
        });
        if (!ok) return;
        await clearWeekShoppingItems();
        await insertWeekShoppingItems(agg);
      } finally {
        setBusyExport(false);
      }
    })();
  }, [busyExport, confirm, endDate, startDate]);

  const clearWeek = useCallback(() => {
    if (busyClear) return;
    void (async () => {
      const ok = await confirm({
        title: 'Weekplanner wissen?',
        message: `Dit verwijdert alle geplande dagen van ${formatDateDdMmYyyy(startDate)} t/m ${formatDateDdMmYyyy(endDate)}.`,
        confirmText: 'Wissen',
        cancelText: 'Annuleren',
        destructive: true,
      });
      if (!ok) return;
      setBusyClear(true);
      try {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setPlansByDate({});
        setPendingNewByDate({});
        setPendingLeftoverOfDateByDate({});
        await deleteWeekPlansBetween(startDate, endDate);
        sessionSuggestedCookingRecipeIdsRef.current = new Set();
        reload();
      } finally {
        setBusyClear(false);
      }
    })();
  }, [busyClear, confirm, endDate, reload, startDate]);

  const generateWeekPlan = useCallback(() => {
    if (busyGenerate) return;
    void (async () => {
      setBusyGenerate(true);
      try {
        await ensureDatabaseAsync();
        const hasKey = await hasActiveAiKey();
        if (!hasKey) {
          Alert.alert(
            'AI niet ingesteld',
            'Stel eerst een API-sleutel en model in bij Instellingen.'
          );
          return;
        }

        const selectedDays = dates.filter((d) => selectedByDate[d]);
        if (selectedDays.length === 0) {
          Alert.alert('Geen dagen gekozen', 'Selecteer minstens één dag om te plannen.');
          return;
        }

        const promptPack = await listRecipesForWeekPlanningPrompt();
        const promptRecipes = promptPack.recipes;
        if (promptRecipes.length === 0) {
          Alert.alert(
            'Geen recepten',
            'Voeg eerst één of meer recepten toe voordat je een weekmenu laat genereren.'
          );
          return;
        }

        await hydrateAiCookProfileFromDb();
        const profile = getAiCookProfile();
        const defaultServings = profile.defaultServings ?? 2;

        // Avoid repeating the same few recipes across multiple "generate" attempts:
        // provide the last ~4 weeks of planned cooking recipes as hard avoid context.
        const recentStart = addDays(startDate, -28);
        const recentEnd = addDays(startDate, -1);
        const recentRows = await listWeekPlansBetween(recentStart, recentEnd);
        const historicalIds = Array.from(
          new Set(
            recentRows
              .filter((r) => (r.leftoverOfDate ?? null) == null)
              .map((r) => r.recipeId)
              .filter((id) => Number.isFinite(id) && id > 0)
          )
        );
        const sessionIds = Array.from(sessionSuggestedCookingRecipeIdsRef.current.values());
        const recentlyUsedRecipeIds = Array.from(new Set([...historicalIds, ...sessionIds]));
        const recentlyUsedSet = new Set(recentlyUsedRecipeIds.map((x) => String(x)));

        const recipeIdSet = new Set(promptRecipes.map((r) => r.id));
        const system = buildWeekPlanSystemPrompt();
        const user = buildWeekPlanUserPrompt({
          currentDate: toIsoDateOnly(new Date()),
          days: selectedDays,
          recipes: promptRecipes,
          wishesText,
          defaultServings,
          recentlyUsedRecipeIds,
          selectionMeta: promptPack.capped
            ? { totalInLibrary: promptPack.totalInLibrary, includedInPrompt: promptRecipes.length }
            : undefined,
        });

        const res = await callAiText({
          system,
          user,
          maxTokens: 4096,
          task: 'weekplan',
        });
        if (!res.ok) {
          Alert.alert('AI-fout', res.message);
          return;
        }

        const tryParse = (
          rawText: string
        ):
          | {
              ok: true;
              plan: {
                date: string;
                recipeId: number | string;
                servings: number;
                cooksForDays: number;
                leftoverOfDate: string | null;
              }[];
              newRecipes: { tempId: string; recipeJsonText: string }[];
            }
          | { ok: false; errors: string[] } => {
          let j: unknown;
          try {
            j = JSON.parse(rawText);
          } catch {
            return { ok: false, errors: ['Antwoord was geen geldige JSON.'] };
          }
          if (!isRecord(j)) return { ok: false, errors: ['JSON-root is geen object.'] };
          const newRecipesIn = Array.isArray(j.new_recipes) ? j.new_recipes : [];
          const newRecipes: { tempId: string; recipeJsonText: string }[] = [];
          const seenTemp = new Set<string>();
          const newRecipeErrs: string[] = [];
          for (const row of newRecipesIn) {
            if (!isRecord(row)) {
              newRecipeErrs.push('Een item in "new_recipes" is geen object.');
              continue;
            }
            const tempId = typeof row.temp_id === 'string' ? row.temp_id.trim() : '';
            if (!tempId) {
              newRecipeErrs.push('Een item in "new_recipes" mist "temp_id".');
              continue;
            }
            if (seenTemp.has(tempId)) {
              newRecipeErrs.push(`Dubbele temp_id in "new_recipes": ${tempId}.`);
              continue;
            }
            seenTemp.add(tempId);
            if (!isRecord(row.recipe)) {
              newRecipeErrs.push(`"recipe" ontbreekt of is geen object voor temp_id ${tempId}.`);
              continue;
            }
            newRecipes.push({ tempId, recipeJsonText: JSON.stringify(row.recipe) });
          }

          const plan = Array.isArray(j.plan) ? j.plan : null;
          if (!plan) return { ok: false, errors: ['Veld "plan" ontbreekt of is geen array.'] };

          const expected = new Set(selectedDays);
          const seen = new Set<string>();
          const out: {
            date: string;
            recipeId: number | string;
            servings: number;
            cooksForDays: number;
            leftoverOfDate: string | null;
          }[] = [];
          const errs: string[] = [];

          for (const row of plan) {
            if (!isRecord(row)) {
              errs.push('Een plan-item is geen object.');
              continue;
            }
            const date = typeof row.date === 'string' ? row.date.trim() : '';
            const recipeIdRaw = row.recipe_id;
            const recipeId =
              typeof recipeIdRaw === 'string'
                ? recipeIdRaw.trim()
                : clampInt(recipeIdRaw, 1, 1_000_000_000, -1);
            const servings = clampInt(row.servings, 1, 99, 2);
            const cooksForDays = clampInt(row.cooks_for_days, 1, 7, 1);
            const leftoverOfDateRaw = row.leftover_of_date;
            const leftoverOfDate =
              typeof leftoverOfDateRaw === 'string'
                ? leftoverOfDateRaw.trim()
                : leftoverOfDateRaw == null
                  ? null
                  : null;

            if (!date) {
              errs.push('Plan-item mist "date".');
              continue;
            }
            if (!expected.has(date)) {
              errs.push(`Onverwachte date in plan: ${date}.`);
              continue;
            }
            if (seen.has(date)) {
              errs.push(`Duplicate date in plan: ${date}.`);
              continue;
            }
            if (typeof recipeId === 'number') {
              if (!recipeIdSet.has(recipeId)) {
                errs.push(`Onbekende recipe_id in plan (${recipeId}) voor ${date}.`);
                continue;
              }
            } else {
              if (!recipeId) {
                errs.push(`Lege recipe_id in plan voor ${date}.`);
                continue;
              }
              if (!seenTemp.has(recipeId)) {
                errs.push(`Onbekende temp recipe_id in plan (${recipeId}) voor ${date}.`);
                continue;
              }
            }

            if (leftoverOfDate) {
              if (!expected.has(leftoverOfDate)) {
                errs.push(
                  `leftover_of_date (${leftoverOfDate}) valt niet binnen de gekozen dagen (voor ${date}).`
                );
                continue;
              }
              if (leftoverOfDate >= date) {
                errs.push(`leftover_of_date (${leftoverOfDate}) moet vóór ${date} liggen.`);
                continue;
              }
              if (cooksForDays > 1) {
                errs.push(`Restjes-dag ${date} mag geen cooks_for_days > 1 hebben.`);
                continue;
              }
            }

            seen.add(date);
            out.push({ date, recipeId, servings, cooksForDays, leftoverOfDate });
          }

          for (const d of expected) {
            if (!seen.has(d)) errs.push(`Ontbrekende date in plan: ${d}.`);
          }

          if (errs.length === 0) {
            const byDate = new Map(out.map((p) => [p.date, p] as const));
            for (const p of out) {
              if (!p.leftoverOfDate) continue;
              const src = byDate.get(p.leftoverOfDate) ?? null;
              if (!src) {
                errs.push(
                  `Restjes-dag ${p.date} verwijst naar ontbrekende kookdag ${p.leftoverOfDate}.`
                );
                continue;
              }
              if (src.leftoverOfDate) {
                errs.push(
                  `Restjes-dag ${p.date} verwijst naar ${p.leftoverOfDate}, maar die is zelf ook een restjes-dag.`
                );
                continue;
              }
              if (String(src.recipeId) !== String(p.recipeId)) {
                errs.push(
                  `Restjes-dag ${p.date} moet hetzelfde recept hebben als ${p.leftoverOfDate}.`
                );
                continue;
              }
              // Normalize: leftovers day servings must match the cooking day servings (servings = eaters, not total cooked portions).
              if (p.servings !== src.servings) {
                p.servings = src.servings;
              }
              // Prefer consecutive day(s), but allow gaps if the AI chose it.
              // We still validate that cooks_for_days is large enough to cover the calendar span.
              const needed = diffDays(p.date, src.date) + 1;
              if (!Number.isFinite(needed) || needed <= 1) {
                errs.push(`Ongeldige restjes-datum combinatie: ${src.date} -> ${p.date}.`);
                continue;
              }
              if (src.cooksForDays < needed) {
                errs.push(
                  `Kookdag ${src.date} heeft cooks_for_days=${src.cooksForDays}, maar moet ≥ ${needed} zijn voor restjes op ${p.date}.`
                );
              }
            }
          }

          if (errs.length === 0) {
            // If the same recipe is used again on a later day, treat it as leftovers of the first day.
            // This keeps the UX simple: second occurrence becomes "Restje:" and doesn't count as a new cooking day.
            const byDate = new Map(out.map((p) => [p.date, p] as const));
            const firstCookByRecipeKey = new Map<
              string,
              { date: string; servings: number; cooksForDays: number }
            >();
            for (const p of out) {
              if (p.leftoverOfDate) continue;
              const key = String(p.recipeId);
              const first = firstCookByRecipeKey.get(key) ?? null;
              if (!first) {
                firstCookByRecipeKey.set(key, {
                  date: p.date,
                  servings: p.servings,
                  cooksForDays: p.cooksForDays,
                });
                continue;
              }
              const needed = diffDays(p.date, first.date) + 1;
              if (!Number.isFinite(needed) || needed <= 1) continue;

              // Convert this later cooking day into a leftovers day of the first cook date.
              p.leftoverOfDate = first.date;
              p.cooksForDays = 1;
              p.servings = first.servings;

              // Ensure the original cooking day cooks_for_days covers the leftovers day.
              const src = byDate.get(first.date) ?? null;
              if (src && !src.leftoverOfDate && src.cooksForDays < needed) {
                src.cooksForDays = needed;
              }
            }
          }

          if (errs.length === 0 && recentlyUsedSet.size > 0) {
            for (const p of out) {
              if (p.leftoverOfDate) continue;
              const key = String(p.recipeId);
              if (recentlyUsedSet.has(key)) {
                errs.push(
                  `Recept ${key} is recent gebruikt. Kies liever een ander recept (tenzij er te weinig opties zijn).`
                );
                break;
              }
            }
          }

          const combined = [...newRecipeErrs, ...errs];
          if (combined.length > 0) return { ok: false, errors: combined };
          return { ok: true, plan: out, newRecipes };
        };

        let parsed = tryParse(res.text);
        if (!parsed.ok) {
          const repairUser = buildAiRepairUserPrompt({
            purpose: 'weekPlan',
            outputSchema: WEEK_PLAN_OUTPUT_SCHEMA,
            previousOutput: res.text,
            validationErrors: parsed.errors,
          });
          const repaired = await callAiText({
            system: buildWeekPlanSystemPrompt(),
            user: repairUser,
            maxTokens: 4096,
            task: 'weekplan',
          });
          if (!repaired.ok) {
            Alert.alert('AI-fout', repaired.message);
            return;
          }
          parsed = tryParse(repaired.text);
        }

        if (!parsed.ok) {
          Alert.alert(
            'AI-output niet bruikbaar',
            `Kon weekmenu niet verwerken:\n\n- ${parsed.errors.slice(0, 6).join('\n- ')}`
          );
          return;
        }

        const newRecipeByTemp = new Map<string, { title: string; recipeJsonText: string }>();
        for (const nr of parsed.newRecipes) {
          const parsedRecipe = parseExtractedRecipeJson(nr.recipeJsonText, '');
          if (!parsedRecipe.ok) {
            Alert.alert(
              'Nieuw recept niet bruikbaar',
              `Kon nieuw recept niet verwerken (${nr.tempId}): ${parsedRecipe.reason}`
            );
            return;
          }
          newRecipeByTemp.set(nr.tempId, {
            title: parsedRecipe.payload.title.trim() || 'Nieuw recept',
            recipeJsonText: nr.recipeJsonText,
          });
        }

        const pending: Record<
          string,
          {
            tempId: string;
            title: string;
            recipeJsonText: string;
            servings: number;
            cooksForDays: number;
            leftoverOfDate: string | null;
          }
        > = {};
        const pendingLeftovers: Record<string, string> = {};

        for (const p of parsed.plan) {
          if (typeof p.recipeId === 'number') {
            // Existing recipe: apply immediately.
            if ((p.leftoverOfDate ?? null) == null)
              sessionSuggestedCookingRecipeIdsRef.current.add(p.recipeId);
            await upsertWeekPlan({
              date: p.date,
              recipeId: p.recipeId,
              servings: p.servings,
              cooksForDays: p.cooksForDays,
              leftoverOfDate: p.leftoverOfDate ?? null,
            });
            continue;
          }

          const nr = newRecipeByTemp.get(p.recipeId) ?? null;
          if (!nr) {
            Alert.alert(
              'Weekmenu niet compleet',
              `Kon een nieuw recept niet koppelen voor ${p.date}.`
            );
            return;
          }
          if ((p.leftoverOfDate ?? null) != null) {
            // New recipe used again: treat as leftovers of the original cook date.
            pendingLeftovers[p.date] = p.leftoverOfDate ?? p.date;
          } else {
            pending[p.date] = {
              tempId: p.recipeId,
              title: nr.title,
              recipeJsonText: nr.recipeJsonText,
              servings: p.servings,
              cooksForDays: p.cooksForDays,
              leftoverOfDate: null,
            };
          }
        }

        if (Object.keys(pending).length > 0) {
          setPendingNewByDate((prev) => ({ ...prev, ...pending }));
        }
        if (Object.keys(pendingLeftovers).length > 0) {
          setPendingLeftoverOfDateByDate((prev) => ({ ...prev, ...pendingLeftovers }));
        }

        reload();
      } finally {
        setBusyGenerate(false);
      }
    })();
  }, [busyGenerate, dates, reload, selectedByDate, wishesText]);

  const approvePendingNewRecipe = useCallback(
    (date: string) => {
      const pending = pendingNewByDate[date] ?? null;
      if (!pending) return;
      void (async () => {
        const parsedRecipe = parseExtractedRecipeJson(pending.recipeJsonText, '');
        if (!parsedRecipe.ok) {
          Alert.alert('Nieuw recept niet bruikbaar', parsedRecipe.reason);
          return;
        }
        const newId = await createRecipe(parsedRecipe.payload);
        if ((pending.leftoverOfDate ?? null) == null) {
          sessionSuggestedCookingRecipeIdsRef.current.add(newId);
        }
        await upsertWeekPlan({
          date,
          recipeId: newId,
          servings: pending.servings,
          cooksForDays: pending.cooksForDays,
          leftoverOfDate: pending.leftoverOfDate ?? null,
        });
        await syncLeftoversForCookDate(date, newId, pending.servings);

        // Apply any pending leftovers days that point to this cook date.
        const leftoverDates = Object.entries(pendingLeftoverOfDateByDate)
          .filter(([, src]) => src === date)
          .map(([d]) => d);
        for (const d of leftoverDates) {
          await upsertWeekPlan({
            date: d,
            recipeId: newId,
            servings: pending.servings,
            cooksForDays: 1,
            leftoverOfDate: date,
          });
        }
        setPendingNewByDate((prev) => {
          const out = { ...prev };
          delete out[date];
          return out;
        });
        if (leftoverDates.length > 0) {
          setPendingLeftoverOfDateByDate((prev) => {
            const out = { ...prev };
            for (const d of leftoverDates) delete out[d];
            return out;
          });
        }
        reload();
      })();
    },
    [pendingLeftoverOfDateByDate, pendingNewByDate, reload]
  );

  const openReplacePopup = useCallback((date: string) => {
    setPendingReplaceDate(date);
    setPendingReplaceText('');
    setPendingReplaceOpen(true);
  }, []);

  const requestAlternativeRecipe = useCallback(() => {
    const date = pendingReplaceDate;
    if (!date) return;
    const prev = pendingNewByDate[date] ?? null;
    if (!prev) return;
    if (busyReplace) return;
    const comment = pendingReplaceText.trim();
    void (async () => {
      setBusyReplace(true);
      try {
        await ensureDatabaseAsync();
        const hasKey = await hasActiveAiKey();
        if (!hasKey) {
          Alert.alert(
            'AI niet ingesteld',
            'Stel eerst een API-sleutel en model in bij Instellingen.'
          );
          return;
        }
        const promptPack = await listRecipesForWeekPlanningPrompt();
        const promptRecipes = promptPack.recipes;
        const recipeIdSet = new Set(promptRecipes.map((r) => r.id));
        const system = buildWeekPlanSystemPrompt();
        const fixedPlan = dates
          .filter((d) => d !== date)
          .map((d) => {
            const p = plansByDate[d] ?? null;
            if (!p) return null;
            const title = recipeById.get(p.recipeId)?.title ?? '';
            return {
              date: d,
              recipe_id: p.recipeId,
              title,
              leftover_of_date: p.leftoverOfDate ?? null,
            };
          })
          .filter(Boolean);
        const contextLines: string[] = [];
        contextLines.push('CONTEXT (vaste planning, niet aanpassen):');
        contextLines.push(JSON.stringify(fixedPlan));
        contextLines.push('');
        contextLines.push(`OUD VOORSTEL (vervangen, niet toevoegen): ${prev.title}`);
        contextLines.push('');
        contextLines.push(
          'INSTRUCTIE: pas ALLEEN deze dag aan. Houd je aan eerdere wensen/constraints uit wishes_text over de hele week.'
        );
        const user = buildWeekPlanUserPrompt({
          days: [date],
          recipes: promptRecipes,
          wishesText: `${wishesText.trim() || ''}${comment ? `\n\nExtra wensen: ${comment}` : ''}\n\n${contextLines.join('\n')}\n\nMaak liever een ander nieuw recept dan het vorige voorstel. Geef een nieuw recept terug als new_recipes en plan het op deze dag.`,
          defaultServings,
          recentlyUsedRecipeIds: [],
          selectionMeta: promptPack.capped
            ? { totalInLibrary: promptPack.totalInLibrary, includedInPrompt: promptRecipes.length }
            : undefined,
        });

        const res = await callAiText({
          system,
          user,
          maxTokens: 4096,
          task: 'weekplan',
        });
        if (!res.ok) {
          Alert.alert('AI-fout', res.message);
          return;
        }

        // Minimal parser for one-day output (same shape as weekplan).
        const isRecord = (x: unknown): x is Record<string, unknown> =>
          x != null && typeof x === 'object' && !Array.isArray(x);
        const clampInt = (n: unknown, lo: number, hi: number, fallback: number): number => {
          const v = typeof n === 'number' ? n : Number.parseInt(String(n ?? ''), 10);
          if (!Number.isFinite(v)) return fallback;
          const r = Math.round(v);
          return Math.max(lo, Math.min(hi, r));
        };

        const tryParse = (
          rawText: string
        ):
          | {
              ok: true;
              plan: {
                date: string;
                recipeId: number | string;
                servings: number;
                cooksForDays: number;
                leftoverOfDate: string | null;
              }[];
              newRecipes: { tempId: string; recipeJsonText: string }[];
            }
          | { ok: false; errors: string[] } => {
          let j: unknown;
          try {
            j = JSON.parse(rawText);
          } catch {
            return { ok: false, errors: ['Antwoord was geen geldige JSON.'] };
          }
          if (!isRecord(j)) return { ok: false, errors: ['JSON-root is geen object.'] };
          const newRecipesIn = Array.isArray(j.new_recipes) ? j.new_recipes : [];
          const newRecipes: { tempId: string; recipeJsonText: string }[] = [];
          const seenTemp = new Set<string>();
          for (const row of newRecipesIn) {
            if (!isRecord(row)) continue;
            const tempId = typeof row.temp_id === 'string' ? row.temp_id.trim() : '';
            if (!tempId || seenTemp.has(tempId)) continue;
            seenTemp.add(tempId);
            if (!isRecord(row.recipe)) continue;
            newRecipes.push({ tempId, recipeJsonText: JSON.stringify(row.recipe) });
          }
          const planIn = Array.isArray(j.plan) ? j.plan : null;
          if (!planIn) return { ok: false, errors: ['Veld "plan" ontbreekt of is geen array.'] };
          const out: {
            date: string;
            recipeId: number | string;
            servings: number;
            cooksForDays: number;
            leftoverOfDate: string | null;
          }[] = [];
          for (const row of planIn) {
            if (!isRecord(row)) continue;
            const d = typeof row.date === 'string' ? row.date.trim() : '';
            if (d !== date) continue;
            const recipeIdRaw = row.recipe_id;
            const recipeId =
              typeof recipeIdRaw === 'string'
                ? recipeIdRaw.trim()
                : clampInt(recipeIdRaw, 1, 1_000_000_000, -1);
            const servings = clampInt(row.servings, 1, 99, prev.servings);
            const cooksForDays = clampInt(row.cooks_for_days, 1, 7, prev.cooksForDays);
            const lodRaw = row.leftover_of_date;
            const leftoverOfDate =
              typeof lodRaw === 'string' ? lodRaw.trim() : lodRaw == null ? null : null;
            out.push({ date: d, recipeId, servings, cooksForDays, leftoverOfDate });
          }
          if (out.length === 0) return { ok: false, errors: ['Geen plan voor de gekozen dag.'] };
          // Validate recipe id exists or temp exists.
          const p0 = out[0];
          if (typeof p0.recipeId === 'number') {
            if (!recipeIdSet.has(p0.recipeId))
              return { ok: false, errors: ['Onbekende recipe_id.'] };
          } else {
            if (!seenTemp.has(p0.recipeId))
              return { ok: false, errors: ['Onbekende temp recipe_id.'] };
          }
          return { ok: true, plan: out, newRecipes };
        };

        let parsed = tryParse(res.text);
        if (!parsed.ok) {
          const repairUser = buildAiRepairUserPrompt({
            purpose: 'weekPlan',
            outputSchema: WEEK_PLAN_OUTPUT_SCHEMA,
            previousOutput: res.text,
            validationErrors: parsed.errors,
          });
          const repaired = await callAiText({
            system: buildWeekPlanSystemPrompt(),
            user: repairUser,
            maxTokens: 4096,
            task: 'weekplan',
          });
          if (!repaired.ok) {
            Alert.alert('AI-fout', repaired.message);
            return;
          }
          parsed = tryParse(repaired.text);
        }
        if (!parsed.ok) {
          Alert.alert(
            'AI-output niet bruikbaar',
            `Kon alternatief niet verwerken:\n\n- ${parsed.errors.slice(0, 6).join('\n- ')}`
          );
          return;
        }

        const p = parsed.plan[0];
        if (typeof p.recipeId === 'number') {
          await upsertWeekPlan({
            date,
            recipeId: p.recipeId,
            servings: p.servings,
            cooksForDays: p.cooksForDays,
            leftoverOfDate: p.leftoverOfDate ?? null,
          });
          await syncLeftoversForCookDate(date, p.recipeId, p.servings);
          setPendingNewByDate((cur) => {
            const out = { ...cur };
            delete out[date];
            return out;
          });
          setPendingReplaceOpen(false);
          reload();
          return;
        }

        const nr = parsed.newRecipes.find((x) => x.tempId === p.recipeId) ?? null;
        if (!nr) {
          Alert.alert('Weekmenu niet compleet', 'Kon nieuw alternatief recept niet vinden.');
          return;
        }
        const parsedRecipe = parseExtractedRecipeJson(nr.recipeJsonText, '');
        if (!parsedRecipe.ok) {
          Alert.alert('Nieuw recept niet bruikbaar', parsedRecipe.reason);
          return;
        }
        // If this date had pending leftovers attached, clear them (old suggestion is discarded).
        setPendingLeftoverOfDateByDate((cur) => {
          const out = { ...cur };
          for (const [d, src] of Object.entries(out)) {
            if (src === date) delete out[d];
          }
          return out;
        });
        setPendingNewByDate((cur) => ({
          ...cur,
          [date]: {
            tempId: nr.tempId,
            title: parsedRecipe.payload.title.trim() || 'Nieuw recept',
            recipeJsonText: nr.recipeJsonText,
            servings: p.servings,
            cooksForDays: p.cooksForDays,
            leftoverOfDate: null,
          },
        }));
        setPendingReplaceOpen(false);
      } finally {
        setBusyReplace(false);
      }
    })();
  }, [
    busyReplace,
    defaultServings,
    pendingNewByDate,
    pendingReplaceDate,
    pendingReplaceText,
    reload,
    wishesText,
  ]);

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

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ConfirmDialog />
      <View
        style={[styles.loadingOverlay, { paddingTop: 10 + insets.top, opacity: loading ? 1 : 0 }]}
        pointerEvents="none"
      >
        <View style={styles.loadingRow}>
          <ActivityIndicator color={theme.accent} />
          <Text style={styles.loadingText}>Laden…</Text>
        </View>
      </View>

      <Modal
        visible={quickAddOpen}
        animationType="fade"
        transparent
        onRequestClose={clearQuickAddParam}
      >
        <View style={styles.quickBackdrop}>
          <Pressable style={styles.quickBackdropPress} onPress={clearQuickAddParam} />
          <View style={[styles.quickCard, { backgroundColor: theme.background }]}>
            <Text style={styles.quickTitle} numberOfLines={1}>
              Zet in weekplanner
            </Text>
            <Text style={styles.quickSub} numberOfLines={2}>
              {quickRecipeTitle ?? ''}
            </Text>
            <View style={styles.quickDates}>
              {dates.map((d, i) => (
                <Pressable
                  key={d}
                  style={[styles.quickDateBtn, { borderColor: theme.accentBorderMuted }]}
                  onPress={() => quickAddToDate(d)}
                >
                  <Text style={styles.quickDateBtnText}>{labelForIndex(i, d)}</Text>
                  <Text style={styles.quickDateBtnSub} numberOfLines={1}>
                    {plannedTitleByDate[d] ?? '—'}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Pressable style={styles.quickCancel} onPress={clearQuickAddParam}>
              <Text style={styles.quickCancelText}>Annuleren</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <View style={styles.plannerTopBar}>
        <Pressable
          style={[
            styles.topPrimaryBtn,
            { backgroundColor: theme.accent },
            busyGenerate && styles.btnOff,
          ]}
          onPress={() => setGenerateSheetOpen(true)}
          disabled={busyGenerate}
        >
          {busyGenerate ? (
            <ActivityIndicator color="#fff" size="small" style={styles.topPrimarySpinner} />
          ) : null}
          <Text style={styles.topPrimaryBtnText} numberOfLines={1}>
            {busyGenerate ? 'Bezig…' : 'Maak weekmenu'}
          </Text>
        </Pressable>
        <Pressable
          style={[
            styles.topSecondaryBtn,
            { borderColor: theme.accentBorderMuted },
            busyExport && styles.btnOff,
          ]}
          onPress={exportToShopping}
          disabled={busyExport}
        >
          <Text style={[styles.topSecondaryBtnText, { color: theme.accent }]} numberOfLines={1}>
            Maak lijstje
          </Text>
        </Pressable>
        <Pressable
          style={styles.overflowMenuBtn}
          onPress={() => setOverflowMenuOpen(true)}
          hitSlop={10}
          accessibilityLabel="Meer"
        >
          <MaterialIcons name="more-vert" size={24} color="#444" />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.listContent} keyboardShouldPersistTaps="handled">
        {dates.map((date, i) => {
          const plan = plansByDate[date] ?? null;
          const recipe = plan ? (recipeById.get(plan.recipeId) ?? null) : null;
          const expanded = !!expandedByDate[date];
          const pendingNew = pendingNewByDate[date] ?? null;
          const pendingLeftoverSrc = pendingLeftoverOfDateByDate[date] ?? null;
          const cookDateForPendingLeftover = pendingLeftoverSrc ?? plan?.leftoverOfDate ?? null;
          const pendingCook =
            !pendingNew && cookDateForPendingLeftover
              ? (pendingNewByDate[cookDateForPendingLeftover] ?? null)
              : null;
          const displayTitle = pendingNew
            ? pendingNew.title
            : pendingCook
              ? `Restje: ${pendingCook.title}`
              : plan && (plan.leftoverOfDate ?? null) != null
                ? `Restje: ${recipe?.title ?? 'Kies een recept…'}`
                : (recipe?.title ?? 'Kies een recept…');
          return (
            <View
              key={date}
              style={[styles.dayCard, plan && expanded ? styles.dayCardExpanded : null]}
            >
              <View style={styles.dayTopRow}>
                {plan ? (
                  <Pressable
                    style={{ flex: 1, minWidth: 0 }}
                    onPress={() => toggleExpandedForDate(date)}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel="Toon opties voor deze dag"
                  >
                    <Text style={styles.dayLabelTop} numberOfLines={1}>
                      {labelForIndex(i, date)}
                    </Text>
                  </Pressable>
                ) : (
                  <Text style={styles.dayLabelTop} numberOfLines={1}>
                    {labelForIndex(i, date)}
                  </Text>
                )}
                {plan ? (
                  <View style={styles.dayTopIcons}>
                    <Pressable
                      style={styles.dayIconBtn}
                      onPress={() => removePlan(date)}
                      hitSlop={10}
                      accessibilityLabel="Dag wissen"
                    >
                      <MaterialIcons name="delete" size={20} color="#b00020" />
                    </Pressable>
                    <Pressable
                      style={styles.dayIconBtn}
                      onPress={() => toggleExpandedForDate(date)}
                      hitSlop={10}
                      accessibilityLabel="Porties en meerdere dagen"
                    >
                      <MaterialIcons
                        name={expanded ? 'expand-less' : 'expand-more'}
                        size={24}
                        color="#666"
                      />
                    </Pressable>
                  </View>
                ) : null}
              </View>
              <View style={[styles.dayPickRow, busyGenerate ? styles.dayPickRowDisabled : null]}>
                <Pressable
                  style={styles.dayPickMain}
                  onPress={() => {
                    if (plan || pendingNew || pendingCook) openRecipePreview(date);
                    else openPickerForDate(date);
                  }}
                  disabled={busyGenerate}
                  hitSlop={10}
                >
                  <Text
                    style={
                      plan || pendingNew || pendingCook
                        ? styles.dayRecipeTitle
                        : styles.dayPlaceholderTitle
                    }
                    numberOfLines={2}
                  >
                    {displayTitle}
                  </Text>
                </Pressable>
                <Pressable
                  style={styles.swapBtn}
                  onPress={() => openPickerForDate(date)}
                  disabled={busyGenerate}
                  hitSlop={10}
                  accessibilityLabel="Recept wisselen"
                >
                  <MaterialIcons name="autorenew" size={22} color="#666" />
                </Pressable>
              </View>
              {pendingNew ? (
                <View style={styles.newRecipeActionsRow}>
                  <Text style={styles.newRecipeBadge}>New!</Text>
                  <Pressable
                    style={[styles.newRecipeApproveBtn, { borderColor: theme.accent }]}
                    onPress={() => approvePendingNewRecipe(date)}
                    disabled={busyGenerate || busyReplace}
                  >
                    <MaterialIcons name="check" size={18} color={theme.accent} />
                    <Text style={[styles.newRecipeApproveText, { color: theme.accent }]}>
                      Toevoegen
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[styles.newRecipeOtherBtn, { borderColor: theme.accentBorderMuted }]}
                    onPress={() => openReplacePopup(date)}
                    disabled={busyGenerate || busyReplace}
                  >
                    <Text style={styles.newRecipeOtherText}>Iets anders</Text>
                  </Pressable>
                </View>
              ) : null}
              {plan ? (
                <Pressable
                  onPress={() => toggleExpandedForDate(date)}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="Toon opties voor deze dag"
                >
                  <Text style={styles.daySubMeta}>
                    {plan.servings}p
                    {plan.cooksForDays > 1 && (plan.leftoverOfDate ?? null) == null
                      ? ' · Meerdere dagen'
                      : ''}
                  </Text>
                </Pressable>
              ) : null}
              {plan && expanded ? (
                <View style={styles.expandedBlock}>
                  <View style={styles.field}>
                    <View style={styles.stepper}>
                      <Pressable
                        style={styles.stepBtn}
                        onPress={() => {
                          const next = Math.max(1, plan.servings - 1);
                          setPlansByDate((prev) => ({
                            ...prev,
                            [date]: { ...plan, servings: next },
                          }));
                          persistPlan({
                            date,
                            recipeId: plan.recipeId,
                            servings: next,
                            cooksForDays: plan.cooksForDays,
                            leftoverOfDate: plan.leftoverOfDate ?? null,
                          });
                        }}
                        hitSlop={10}
                      >
                        <Text style={styles.stepBtnText}>−</Text>
                      </Pressable>
                      <Text style={styles.stepValue}>{plan.servings} p.</Text>
                      <Pressable
                        style={styles.stepBtn}
                        onPress={() => {
                          const next = Math.min(99, plan.servings + 1);
                          setPlansByDate((prev) => ({
                            ...prev,
                            [date]: { ...plan, servings: next },
                          }));
                          persistPlan({
                            date,
                            recipeId: plan.recipeId,
                            servings: next,
                            cooksForDays: plan.cooksForDays,
                            leftoverOfDate: plan.leftoverOfDate ?? null,
                          });
                        }}
                        hitSlop={10}
                      >
                        <Text style={styles.stepBtnText}>+</Text>
                      </Pressable>
                    </View>
                  </View>
                  {(plan.leftoverOfDate ?? null) == null ? (
                    <Pressable
                      style={[styles.multiCookRow, { borderColor: theme.accentBorderMuted }]}
                      onPress={() => {
                        const nextOn = plan.cooksForDays <= 1;
                        const next = nextOn ? 7 : 1;
                        setPlansByDate((prev) => ({
                          ...prev,
                          [date]: { ...plan, cooksForDays: next },
                        }));
                        persistPlan({
                          date,
                          recipeId: plan.recipeId,
                          servings: plan.servings,
                          cooksForDays: next,
                          leftoverOfDate: null,
                        });
                      }}
                      hitSlop={10}
                    >
                      <View
                        style={[
                          styles.checkboxSmall,
                          { borderColor: theme.accent },
                          plan.cooksForDays > 1
                            ? [styles.checkboxSmallOn, { backgroundColor: theme.accent }]
                            : null,
                        ]}
                      >
                        <Text style={styles.checkboxMarkSmall}>
                          {plan.cooksForDays > 1 ? '✓' : ''}
                        </Text>
                      </View>
                      <Text style={styles.multiCookLabel}>Meerdere dagen</Text>
                    </Pressable>
                  ) : (
                    <View style={styles.multiCookPlaceholder} pointerEvents="none" />
                  )}
                </View>
              ) : null}
            </View>
          );
        })}
      </ScrollView>

      <Modal
        visible={overflowMenuOpen}
        animationType="fade"
        transparent
        onRequestClose={() => setOverflowMenuOpen(false)}
      >
        <View style={styles.overflowRoot}>
          <Pressable style={styles.overflowDim} onPress={() => setOverflowMenuOpen(false)} />
          <View
            style={[styles.overflowCard, { top: insets.top + 8, right: 14 }]}
            pointerEvents="box-none"
          >
            <Pressable
              style={styles.overflowItem}
              onPress={() => {
                setOverflowMenuOpen(false);
                router.push('/settings/cook-profile-ai');
              }}
            >
              <Text style={styles.overflowItemText}>AI kookprofiel</Text>
            </Pressable>
            <Pressable
              style={styles.overflowItem}
              onPress={() => {
                setOverflowMenuOpen(false);
                clearWeek();
              }}
              disabled={busyClear}
            >
              <Text style={styles.overflowDestructive}>Wis weekplanner</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={generateSheetOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setGenerateSheetOpen(false)}
      >
        <View style={styles.sheetRoot}>
          <Pressable style={styles.sheetDim} onPress={() => setGenerateSheetOpen(false)} />
          <View style={styles.generateSheet}>
            <Text style={styles.generateSheetTitle}>Maak weekmenu</Text>
            <TextInput
              style={styles.wishesInputSheet}
              placeholder="Optioneel: wensen (bijv. ‘licht deze week’, ‘iets met aubergine’)…"
              placeholderTextColor="#999"
              value={wishesText}
              onChangeText={setWishesText}
              multiline
            />
            {weekPlanRecipeLibraryCount > MAX_RECIPES_IN_WEEK_PLAN_PROMPT ? (
              <Text style={styles.weekPlanAiHint}>
                Je hebt {weekPlanRecipeLibraryCount} recepten. Voor weekmenu-AI worden maximaal{' '}
                {MAX_RECIPES_IN_WEEK_PLAN_PROMPT} tegelijk meegestuurd (favorieten, &apos;wil
                proberen&apos; en recent voorrang).
              </Text>
            ) : null}
            <View style={styles.welkeDagenHeader}>
              <Text style={styles.generateSectionLabelFlat}>Welke dagen?</Text>
              <View style={styles.allesNietsRow}>
                <Pressable
                  style={styles.hintChip}
                  onPress={() => {
                    setSelectedByDate((prev) => {
                      const next = { ...prev };
                      for (const d of dates) next[d] = true;
                      return next;
                    });
                  }}
                >
                  <Text style={styles.hintChipText}>Alles</Text>
                </Pressable>
                <Pressable
                  style={styles.hintChip}
                  onPress={() => {
                    setSelectedByDate((prev) => {
                      const next = { ...prev };
                      for (const d of dates) next[d] = false;
                      return next;
                    });
                  }}
                >
                  <Text style={styles.hintChipText}>Niets</Text>
                </Pressable>
              </View>
            </View>
            <ScrollView style={styles.genDayListScroll} keyboardShouldPersistTaps="handled">
              {dates.map((date, dayIdx) => {
                const on = !!selectedByDate[date];
                const isLast = dayIdx === dates.length - 1;
                const plan = plansByDate[date] ?? null;
                const pendingNew = pendingNewByDate[date] ?? null;
                const pendingLeftoverSrc = pendingLeftoverOfDateByDate[date] ?? null;
                const cookDateForPendingLeftover =
                  pendingLeftoverSrc ?? plan?.leftoverOfDate ?? null;
                const pendingCook =
                  !pendingNew && cookDateForPendingLeftover
                    ? (pendingNewByDate[cookDateForPendingLeftover] ?? null)
                    : null;
                const existingTitle = pendingNew
                  ? pendingNew.title
                  : pendingCook
                    ? `Restje: ${pendingCook.title}`
                    : plan
                      ? plan.leftoverOfDate
                        ? `Restje: ${recipeById.get(plan.recipeId)?.title ?? ''}`
                        : (recipeById.get(plan.recipeId)?.title ?? '')
                      : '';
                return (
                  <Pressable
                    key={date}
                    style={[styles.genDayRow, isLast ? styles.genDayRowLast : null]}
                    onPress={() => setSelectedByDate((prev) => ({ ...prev, [date]: !prev[date] }))}
                  >
                    <View
                      style={[
                        styles.checkbox,
                        { borderColor: on ? theme.accent : '#c9c2b8' },
                        on ? [styles.checkboxOn, { backgroundColor: theme.accent }] : null,
                      ]}
                    >
                      <Text style={styles.checkboxMark}>{on ? '✓' : ''}</Text>
                    </View>
                    <View style={styles.genDayTextCol}>
                      <Text style={styles.genDayLabel}>{labelForIndex(dayIdx, date)}</Text>
                      {existingTitle.trim() ? (
                        <Text style={styles.genDayExisting} numberOfLines={1}>
                          {existingTitle}
                        </Text>
                      ) : null}
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
            <View style={styles.generateSheetActions}>
              <Pressable style={styles.generateCancel} onPress={() => setGenerateSheetOpen(false)}>
                <Text style={styles.generateCancelText}>Annuleren</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.generateGoBtn,
                  { backgroundColor: theme.accent },
                  busyGenerate && styles.btnOff,
                ]}
                onPress={() => {
                  setGenerateSheetOpen(false);
                  generateWeekPlan();
                }}
                disabled={busyGenerate}
              >
                {busyGenerate ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.generateGoBtnText}>Genereer</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={pickerOpen} animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <View style={[styles.pickerRoot, { backgroundColor: theme.background }]}>
          <View style={styles.pickerHeader}>
            <Text style={styles.pickerTitle}>Kies recept</Text>
            <Pressable
              onPress={() => {
                closePickerSheets();
                setPickerOpen(false);
              }}
              hitSlop={10}
            >
              <Text style={[styles.close, { color: theme.accent }]}>Sluiten</Text>
            </Pressable>
          </View>
          <TextInput
            style={styles.searchInput}
            placeholder="Zoek recept..."
            placeholderTextColor="#999"
            value={pickerQuery}
            onChangeText={setPickerQuery}
            autoCorrect={false}
            autoCapitalize="none"
          />

          <View style={styles.pickerChipRowMain}>
            <View style={styles.pickerChipRowLeft}>
              <Pressable
                style={[styles.pickerChip, pickerFavoritesOnly ? pickerChipOnStyle : null]}
                onPress={() => setPickerFavoritesOnly((v) => !v)}
              >
                <Text
                  style={[
                    styles.pickerChipText,
                    pickerFavoritesOnly ? pickerChipTextOnStyle : null,
                  ]}
                >
                  Favorieten
                </Text>
              </Pressable>
              <Pressable
                style={[styles.pickerChip, pickerWantToTryOnly ? pickerChipOnStyle : null]}
                onPress={() => setPickerWantToTryOnly((v) => !v)}
              >
                <Text
                  style={[
                    styles.pickerChipText,
                    pickerWantToTryOnly ? pickerChipTextOnStyle : null,
                  ]}
                >
                  Wil proberen
                </Text>
              </Pressable>
            </View>
            <Pressable
              style={[
                styles.pickerChip,
                styles.pickerChipFilterBtn,
                pickerSecondaryFilterCount > 0 ? pickerChipOnStyle : null,
              ]}
              onPress={() => setPickerFiltersModalOpen(true)}
            >
              <Text
                style={[
                  styles.pickerChipText,
                  pickerSecondaryFilterCount > 0 ? pickerChipTextOnStyle : null,
                ]}
                numberOfLines={1}
              >
                {pickerSecondaryFilterCount > 0
                  ? `Filters · ${pickerSecondaryFilterCount}`
                  : 'Filters'}
              </Text>
            </Pressable>
          </View>

          <FlatList
            data={filteredRecipes}
            keyExtractor={(it) => String(it.id)}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.pickerList}
            renderItem={({ item }) => (
              <Pressable
                style={styles.pickerRow}
                onPress={() => {
                  const date = activeDate;
                  if (!date) return;
                  setPickerOpen(false);
                  // Initialize with defaults if empty, then persist.
                  setPlansByDate((prev) => ({
                    ...prev,
                    [date]: {
                      recipeId: item.id,
                      servings: prev[date]?.servings ?? defaultServings,
                      cooksForDays: prev[date]?.cooksForDays ?? 1,
                      leftoverOfDate: null,
                    },
                  }));
                  void (async () => {
                    const servings = plansByDate[date]?.servings ?? defaultServings;
                    await upsertWeekPlan({
                      date,
                      recipeId: item.id,
                      servings,
                      cooksForDays: plansByDate[date]?.cooksForDays ?? 1,
                      leftoverOfDate: null,
                    });
                    await syncLeftoversForCookDate(date, item.id, servings);
                    reload();
                  })();
                }}
              >
                <Text style={styles.pickerRowTitle} numberOfLines={2}>
                  {item.title}
                </Text>
                {item.category ? <Text style={styles.pickerRowMeta}>{item.category}</Text> : null}
              </Pressable>
            )}
            ListHeaderComponent={() => {
              const date = activeDate;
              if (!date) return null;
              const options = leftoversForDate(date);
              if (options.length === 0) return null;

              const daysBefore = (sourceDate: string) => {
                const [y1, m1, d1] = date.split('-').map((x) => Number.parseInt(x, 10));
                const [y2, m2, d2] = sourceDate.split('-').map((x) => Number.parseInt(x, 10));
                const a = new Date(y1, (m1 ?? 1) - 1, d1 ?? 1).getTime();
                const b = new Date(y2, (m2 ?? 1) - 1, d2 ?? 1).getTime();
                const diff = Math.round((a - b) / (24 * 60 * 60 * 1000));
                return Math.max(1, diff || 1);
              };

              return (
                <View style={{ paddingBottom: 4 }}>
                  {options.map((opt) => (
                    <Pressable
                      key={`${opt.sourceDate}|${opt.recipeId}`}
                      style={[
                        styles.pickerRow,
                        styles.leftoversRow,
                        { borderColor: theme.accentBorderMuted },
                      ]}
                      onPress={() => {
                        setPickerOpen(false);
                        setPlansByDate((prev) => ({
                          ...prev,
                          [date]: {
                            recipeId: opt.recipeId,
                            servings: prev[date]?.servings ?? opt.servings ?? 2,
                            cooksForDays: 1,
                            leftoverOfDate: opt.sourceDate,
                          },
                        }));
                        void (async () => {
                          await upsertWeekPlan({
                            date,
                            recipeId: opt.recipeId,
                            servings: opt.servings ?? 2,
                            cooksForDays: 1,
                            leftoverOfDate: opt.sourceDate,
                          });
                          reload();
                        })();
                      }}
                    >
                      <Text style={styles.pickerRowTitle} numberOfLines={2}>
                        Restjes {opt.title}
                      </Text>
                      <Text
                        style={[styles.pickerRowMeta, { color: theme.accent }]}
                        numberOfLines={1}
                      >
                        van {daysBefore(opt.sourceDate)} dag
                        {daysBefore(opt.sourceDate) === 1 ? '' : 'en'} ervoor
                      </Text>
                    </Pressable>
                  ))}
                </View>
              );
            }}
            ListEmptyComponent={
              <Text style={styles.empty}>{pickerBusy ? 'Zoeken…' : 'Geen recepten gevonden.'}</Text>
            }
          />
        </View>
      </Modal>

      <Modal
        visible={pickerFiltersModalOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setPickerFiltersModalOpen(false)}
      >
        <View style={styles.sheetRoot}>
          <Pressable style={styles.sheetDim} onPress={() => setPickerFiltersModalOpen(false)} />
          <View style={styles.pickerFiltersSheet}>
            <Text style={styles.pickerFiltersSheetTitle}>Filters</Text>
            <ScrollView
              style={styles.pickerFiltersSheetScroll}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.pickerFiltersSheetScrollInner}
            >
              <Text style={styles.pickerFilterSubLabel}>Max. totale tijd (min.)</Text>
              <View style={styles.pickerTimeSliderRow}>
                <View style={styles.pickerTimeSliderCol}>
                  <Slider
                    style={styles.pickerTimeSlider}
                    minimumValue={10}
                    maximumValue={180}
                    step={5}
                    value={pickerMaxTotalTimeMin ?? 60}
                    minimumTrackTintColor={theme.accent}
                    maximumTrackTintColor="#e2ddd5"
                    thumbTintColor={theme.accent}
                    onValueChange={(v) => {
                      const next = Math.round(v / 5) * 5;
                      setPickerMaxTotalTimeMin(next);
                    }}
                  />
                  <Text style={styles.pickerTimeSliderValue}>
                    {pickerMaxTotalTimeMin == null
                      ? 'Geen maximum'
                      : `Max. ${pickerMaxTotalTimeMin} min`}
                  </Text>
                </View>
                <Pressable
                  style={[
                    styles.pickerTimeSliderResetBtn,
                    pickerMaxTotalTimeMin == null ? styles.pickerTimeSliderResetBtnOff : null,
                  ]}
                  onPress={() => setPickerMaxTotalTimeMin(null)}
                  disabled={pickerMaxTotalTimeMin == null}
                >
                  <Text
                    style={[
                      styles.pickerTimeSliderResetText,
                      pickerMaxTotalTimeMin == null ? styles.pickerTimeSliderResetTextOff : null,
                    ]}
                  >
                    Reset
                  </Text>
                </Pressable>
              </View>

              <Text style={styles.pickerFilterSubLabel}>Dieet</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.pickerChipScroll}
              >
                <View style={styles.pickerChipRow}>
                  <Pressable
                    style={[
                      styles.pickerChip,
                      pickerDietKeys.length === 0 && pickerCustomDietKeys.length === 0
                        ? pickerChipOnStyle
                        : null,
                    ]}
                    onPress={() => {
                      clearPickerDiet();
                      clearPickerCustomDiets();
                    }}
                  >
                    <Text
                      style={[
                        styles.pickerChipText,
                        pickerDietKeys.length === 0 && pickerCustomDietKeys.length === 0
                          ? pickerChipTextOnStyle
                          : null,
                      ]}
                    >
                      Alle
                    </Text>
                  </Pressable>
                  {['vegetarian', 'vegan', 'keto', ...pickerCustomDiets].map((k) => {
                    const isBuiltIn = k === 'vegetarian' || k === 'vegan' || k === 'keto';
                    const on = isBuiltIn
                      ? pickerSelectedDietSet.has(k)
                      : pickerSelectedCustomDietSet.has(k);
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
                        key={`picker-diet-${k}`}
                        style={[styles.pickerChip, on ? pickerChipOnStyle : null]}
                        onPress={() => {
                          if (isBuiltIn) togglePickerDiet(k);
                          else togglePickerCustomDiet(k);
                        }}
                      >
                        <Text
                          style={[styles.pickerChipText, on ? pickerChipTextOnStyle : null]}
                          numberOfLines={1}
                        >
                          {label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </ScrollView>

              {pickerCategories.length > 0 ? (
                <>
                  <Text style={styles.pickerFilterSubLabel}>Categorie</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.pickerChipScroll}
                  >
                    <View style={styles.pickerChipRow}>
                      <Pressable
                        style={[
                          styles.pickerChip,
                          pickerCategoryKey === null ? pickerChipOnStyle : null,
                        ]}
                        onPress={() => setPickerCategoryKey(null)}
                      >
                        <Text
                          style={[
                            styles.pickerChipText,
                            pickerCategoryKey === null ? pickerChipTextOnStyle : null,
                          ]}
                        >
                          Alle
                        </Text>
                      </Pressable>
                      {pickerCategories.map((c) => (
                        <Pressable
                          key={`picker-cat-${c}`}
                          style={[
                            styles.pickerChip,
                            pickerCategoryKey === c ? pickerChipOnStyle : null,
                          ]}
                          onPress={() => setPickerCategoryKey((cur) => (cur === c ? null : c))}
                        >
                          <Text
                            style={[
                              styles.pickerChipText,
                              pickerCategoryKey === c ? pickerChipTextOnStyle : null,
                            ]}
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

              {pickerRecipeTags.length > 0 ? (
                <>
                  <Text style={styles.pickerFilterSubLabel}>Tag</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.pickerChipScroll}
                  >
                    <View style={styles.pickerChipRow}>
                      <Pressable
                        style={[
                          styles.pickerChip,
                          pickerTagKeys.length === 0 ? pickerChipOnStyle : null,
                        ]}
                        onPress={clearPickerTags}
                      >
                        <Text
                          style={[
                            styles.pickerChipText,
                            pickerTagKeys.length === 0 ? pickerChipTextOnStyle : null,
                          ]}
                        >
                          Alle
                        </Text>
                      </Pressable>
                      {pickerTagKeys.map((t) => (
                        <Pressable
                          key={`picker-strip-tag-${t}`}
                          style={[
                            styles.pickerChip,
                            pickerSelectedTagSet.has(t) ? pickerChipOnStyle : null,
                          ]}
                          onPress={() => togglePickerTag(t)}
                        >
                          <Text
                            style={[
                              styles.pickerChipText,
                              pickerSelectedTagSet.has(t) ? pickerChipTextOnStyle : null,
                            ]}
                            numberOfLines={1}
                          >
                            {t}
                          </Text>
                        </Pressable>
                      ))}
                      {pickerExtraTags.length > 0 ? (
                        <Pressable
                          style={[
                            styles.pickerChip,
                            styles.pickerTagsMoreChip,
                            pickerTagKeyInExtra ? pickerChipOnStyle : null,
                          ]}
                          onPress={() => setPickerTagsPickerOpen(true)}
                        >
                          <Text
                            style={[
                              styles.pickerChipText,
                              styles.pickerTagsMoreChipText,
                              pickerTagKeyInExtra ? pickerChipTextOnStyle : null,
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
            <View style={styles.pickerFiltersSheetActions}>
              <Pressable style={styles.pickerFilterClearAllBtn} onPress={clearPickerFilters}>
                <Text style={styles.pickerFilterClearAllText}>Filters wissen</Text>
              </Pressable>
              <Pressable
                style={[styles.pickerFilterDoneBtn, { backgroundColor: theme.accent }]}
                onPress={() => setPickerFiltersModalOpen(false)}
              >
                <Text style={styles.pickerFilterDoneBtnText}>Klaar</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={pickerTagsPickerOpen}
        animationType="fade"
        transparent
        onRequestClose={() => setPickerTagsPickerOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.tagPickerCard}>
            <Text style={styles.modalTitle}>Meer tags</Text>
            <Text style={styles.tagPickerHint}>Tik op een tag om daarop te filteren.</Text>
            <FlatList
              data={pickerExtraTags}
              numColumns={2}
              keyExtractor={(item) => item}
              style={styles.tagPickerList}
              columnWrapperStyle={styles.tagGridRow}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <Pressable
                  style={[
                    styles.tagGridCell,
                    pickerSelectedTagSet.has(item) ? pickerChipOnStyle : null,
                  ]}
                  onPress={() => togglePickerTag(item)}
                >
                  <Text
                    style={[
                      styles.tagGridCellText,
                      pickerSelectedTagSet.has(item) ? pickerChipTextOnStyle : null,
                    ]}
                    numberOfLines={3}
                  >
                    {item}
                  </Text>
                </Pressable>
              )}
            />
            <Pressable
              style={styles.tagPickerCloseBtn}
              onPress={() => setPickerTagsPickerOpen(false)}
            >
              <Text style={styles.tagPickerCloseBtnText}>Klaar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={pendingReplaceOpen}
        animationType="fade"
        transparent
        onRequestClose={() => setPendingReplaceOpen(false)}
      >
        <View style={styles.replaceBackdrop}>
          <Pressable
            style={styles.replaceBackdropPress}
            onPress={() => setPendingReplaceOpen(false)}
          />
          <View style={styles.replaceCard}>
            <Text style={styles.replaceTitle}>Iets anders</Text>
            <Text style={styles.replaceHint}>
              Wat wil je liever? (bijv. “geen vis”, “makkelijk”, “iets met aubergine”)
            </Text>
            <TextInput
              style={styles.replaceInput}
              placeholder="Typ je wensen…"
              placeholderTextColor="#999"
              value={pendingReplaceText}
              onChangeText={setPendingReplaceText}
              multiline
            />
            <View style={styles.replaceActions}>
              <Pressable
                style={styles.replaceCancel}
                onPress={() => setPendingReplaceOpen(false)}
                disabled={busyReplace}
              >
                <Text style={styles.replaceCancelText}>Annuleren</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.replaceAskBtn,
                  { backgroundColor: theme.accent },
                  busyReplace && styles.btnOff,
                ]}
                onPress={requestAlternativeRecipe}
                disabled={busyReplace}
              >
                <Text style={styles.replaceAskBtnText}>{busyReplace ? 'Bezig…' : 'Vraag AI'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={previewOpen} animationType="slide" onRequestClose={closeRecipePreview}>
        <View style={[styles.previewRoot, { backgroundColor: theme.background }]}>
          <View style={[styles.previewHeader, { paddingTop: 8 + insets.top }]}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.previewTitle} numberOfLines={2}>
                {previewTitle || 'Preview'}
              </Text>
              <Text style={styles.previewMeta}>Voor {previewServings} p.</Text>
            </View>
            <Pressable onPress={closeRecipePreview} hitSlop={10}>
              <Text style={[styles.previewClose, { color: theme.accent }]}>Sluiten</Text>
            </Pressable>
          </View>

          {previewLoading ? (
            <View style={styles.previewLoadingRow}>
              <ActivityIndicator color={theme.accent} />
              <Text style={styles.previewLoadingText}>Laden…</Text>
            </View>
          ) : previewError ? (
            <View style={styles.previewErrorWrap}>
              <Text style={styles.previewErrorText}>{previewError}</Text>
              {previewDate ? (
                <Pressable
                  onPress={() => openRecipePreview(previewDate)}
                  style={[styles.previewRetryBtn, { borderColor: theme.accent }]}
                >
                  <Text style={[styles.previewRetryBtnText, { color: theme.accent }]}>
                    Opnieuw proberen
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : (
            <ScrollView
              style={styles.previewScrollView}
              contentContainerStyle={[styles.previewScroll, { paddingBottom: 24 + insets.bottom }]}
              keyboardShouldPersistTaps="handled"
            >
              {previewImageUri ? (
                <Image
                  source={{ uri: previewImageUri }}
                  style={styles.previewImage}
                  resizeMode="cover"
                  accessibilityLabel="Receptfoto"
                />
              ) : null}

              <Text style={styles.previewSectionTitle}>Ingrediënten</Text>
              {previewIngredients.length === 0 ? (
                <Text style={styles.previewEmpty}>Geen ingrediënten.</Text>
              ) : (
                previewIngredients.map((g, gi) => (
                  <View key={`g-${gi}`} style={styles.previewGroup}>
                    {g.title?.trim() ? (
                      <Text style={styles.previewGroupTitle}>{g.title.trim()}</Text>
                    ) : null}
                    {g.ingredients.map((ing, ii) => {
                      const amount = ing.amount != null ? String(ing.amount) : '';
                      const unit = (ing.unit ?? '').trim();
                      const qty = amount ? `${amount}${unit ? ` ${unit}` : ''}` : '';
                      return (
                        <Text key={`ing-${gi}-${ii}`} style={styles.previewLine}>
                          {qty ? `${qty} · ` : ''}
                          {ing.name}
                        </Text>
                      );
                    })}
                  </View>
                ))
              )}

              <Text style={styles.previewSectionTitle}>Stappen</Text>
              {previewSteps.length === 0 ? (
                <Text style={styles.previewEmpty}>Geen stappen.</Text>
              ) : (
                previewSteps.map((s, si) => (
                  <View key={`s-${si}`} style={styles.previewGroup}>
                    {s.title?.trim() ? (
                      <Text style={styles.previewGroupTitle}>{s.title.trim()}</Text>
                    ) : null}
                    {s.steps.map((st, idx) => (
                      <Text key={`st-${si}-${idx}`} style={styles.previewLine}>
                        {idx + 1}. {st.description}
                      </Text>
                    ))}
                  </View>
                ))
              )}
              <View style={{ height: 18 }} />
            </ScrollView>
          )}

          {previewRecipeId != null && !previewLoading && !previewError ? (
            <View style={[styles.previewFooter, { paddingBottom: 12 + insets.bottom }]}>
              <Pressable
                onPress={() => {
                  const id = previewRecipeId;
                  closeRecipePreview();
                  router.push({ pathname: '/recipe/[id]', params: { id: String(id) } });
                }}
                style={[styles.previewGoBtn, { borderColor: theme.accent }]}
              >
                <Text style={[styles.previewGoBtnText, { color: theme.accent }]}>
                  Volledig recept
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 14 },
  quickBackdrop: { flex: 1, justifyContent: 'center', padding: 16 },
  quickBackdropPress: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.45)' },
  quickCard: {
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e2ddd5',
    backgroundColor: '#fff',
  },
  quickTitle: { fontSize: 18, fontWeight: '900', color: '#1a1a1a' },
  quickSub: { fontSize: 13, color: '#666', marginTop: 4, lineHeight: 18, marginBottom: 10 },
  quickDates: { gap: 8 },
  quickDateBtn: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    backgroundColor: '#fff',
  },
  quickDateBtnText: { fontSize: 15, fontWeight: '800', color: '#1a1a1a' },
  quickDateBtnSub: { fontSize: 13, color: '#666', marginTop: 2 },
  quickCancel: { marginTop: 12, alignItems: 'center', paddingVertical: 8 },
  quickCancelText: { fontSize: 16, color: '#666', fontWeight: '700' },
  headerRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginBottom: 10 },
  headerBtns: { gap: 8, alignItems: 'flex-end' },
  title: { fontSize: 22, fontWeight: '800', color: '#1a1a1a' },
  sub: { fontSize: 13, color: '#666', marginTop: 2, lineHeight: 18 },
  primaryBtn: {
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 10,
    alignSelf: 'flex-start',
    maxWidth: 200,
    minWidth: 0,
    flexShrink: 1,
  },
  primaryBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 12,
    textAlign: 'center',
    flexShrink: 1,
  },
  secondaryBtn: {
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 10,
    alignSelf: 'flex-start',
    maxWidth: 200,
    minWidth: 0,
    flexShrink: 1,
    borderWidth: 1,
    backgroundColor: '#fff',
  },
  secondaryBtnText: { fontWeight: '700', fontSize: 12, textAlign: 'center', flexShrink: 1 },
  btnOff: { opacity: 0.5 },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    alignItems: 'center',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#e2ddd5',
    backgroundColor: '#fff',
  },
  loadingText: { fontSize: 14, color: '#666' },
  plannerTopBar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  topPrimaryBtn: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    minHeight: 44,
    justifyContent: 'center',
  },
  topPrimarySpinner: { marginRight: 0 },
  topPrimaryBtnText: { color: '#fff', fontWeight: '800', fontSize: 13, flexShrink: 1 },
  topSecondaryBtn: {
    paddingVertical: 9,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 1,
    backgroundColor: '#fff',
    minHeight: 44,
    justifyContent: 'center',
    flex: 1,
  },
  topSecondaryBtnText: { fontWeight: '800', fontSize: 13, textAlign: 'center', flexShrink: 1 },
  overflowMenuBtn: { padding: 4, minWidth: 40, alignItems: 'center', justifyContent: 'center' },
  overflowRoot: { flex: 1 },
  overflowDim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.2)' },
  overflowCard: {
    position: 'absolute',
    zIndex: 2,
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2ddd5',
    paddingVertical: 4,
    minWidth: 180,
    elevation: 4,
  },
  overflowItem: { paddingVertical: 12, paddingHorizontal: 14 },
  overflowItemText: { color: '#1a1a1a', fontWeight: '800', fontSize: 15 },
  overflowDestructive: { color: '#b00020', fontWeight: '800', fontSize: 15 },
  sheetRoot: { flex: 1, justifyContent: 'flex-end' },
  sheetDim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  generateSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '85%',
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 20,
    zIndex: 1,
  },
  generateSheetTitle: { fontSize: 20, fontWeight: '800', color: '#1a1a1a', marginBottom: 8 },
  weekPlanAiHint: { fontSize: 13, color: '#666', lineHeight: 19, marginBottom: 10 },
  wishesInputSheet: {
    borderWidth: 1,
    borderColor: '#e2ddd5',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    backgroundColor: '#fff',
    minHeight: 80,
  },
  welkeDagenHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    marginBottom: 0,
    gap: 8,
  },
  generateSectionLabelFlat: {
    fontSize: 13,
    fontWeight: '800',
    color: '#555',
    flex: 1,
    minWidth: 0,
  },
  allesNietsRow: { flexDirection: 'row', gap: 8, flexShrink: 0 },
  genDayListScroll: { marginBottom: 8, maxHeight: 400 },
  genDayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee9e1',
  },
  genDayRowLast: { borderBottomWidth: 0 },
  genDayTextCol: { flex: 1, minWidth: 0 },
  genDayLabel: { fontSize: 15, color: '#1a1a1a', flex: 0 },
  genDayExisting: { fontSize: 12, color: '#8a8a8a', marginTop: 2 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: {},
  checkboxMark: { color: '#fff', fontWeight: '800', fontSize: 14, lineHeight: 16 },
  hintChip: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: '#f7f6f3',
    borderWidth: 1,
    borderColor: '#e2ddd5',
  },
  hintChipText: { fontSize: 12, fontWeight: '800', color: '#444' },
  generateSheetActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
    gap: 12,
  },
  generateCancel: { padding: 10 },
  generateCancelText: { color: '#666', fontSize: 16, fontWeight: '600' },
  generateGoBtn: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
    minWidth: 120,
    alignItems: 'center',
  },
  generateGoBtnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  listContent: { paddingBottom: 30 },
  dayCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2ddd5',
    padding: 10,
    marginBottom: 8,
  },
  dayCardExpanded: { backgroundColor: '#f7f6f3' },
  dayTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  dayLabelTop: {
    fontSize: 13,
    lineHeight: 18,
    color: '#666',
    flex: 1,
    minWidth: 0,
    marginLeft: 8,
    paddingVertical: 6,
  },
  dayTopIcons: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dayPickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#e2ddd5',
    borderRadius: 10,
    backgroundColor: '#fff',
  },
  dayPickMain: { flex: 1, minWidth: 0 },
  swapBtn: { padding: 2 },
  dayPickRowDisabled: { opacity: 0.5 },
  dayRecipeTitle: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: '800', color: '#1a1a1a' },
  dayPlaceholderTitle: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: '600', color: '#8a8a8a' },
  daySubMeta: { fontSize: 12, color: '#8a8a8a', marginTop: 6, marginLeft: 8 },
  dayIconBtn: { padding: 6 },
  expandedBlock: {
    marginTop: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    alignItems: 'flex-end',
  },
  fieldsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    alignItems: 'flex-end',
    marginTop: 10,
  },
  field: { flex: 1, minWidth: 110 },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: '#555', marginBottom: 4 },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#e2ddd5',
    borderRadius: 10,
    backgroundColor: '#fff',
    paddingHorizontal: 10,
    paddingVertical: 6,
    minHeight: 48,
  },
  stepBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#f7f6f3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnText: { fontSize: 18, fontWeight: '800', color: '#1a1a1a' },
  stepValue: {
    fontSize: 16,
    fontWeight: '400',
    color: '#1a1a1a',
    minWidth: 30,
    textAlign: 'center',
  },
  multiCookRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    backgroundColor: '#fff',
    flex: 1,
    minWidth: 180,
    minHeight: 48,
  },
  multiCookPlaceholder: { flex: 1, minWidth: 180, minHeight: 48 },
  checkboxSmall: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxSmallOn: {},
  checkboxMarkSmall: { color: '#fff', fontWeight: '800', fontSize: 14, lineHeight: 16 },
  multiCookLabel: { fontSize: 13, fontWeight: '400', color: '#1a1a1a' },
  pickerRoot: { flex: 1, padding: 14 },
  pickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  pickerTitle: { fontSize: 18, fontWeight: '800', color: '#1a1a1a' },
  close: { fontSize: 16, fontWeight: '700' },
  searchInput: {
    borderWidth: 1,
    borderColor: '#e2ddd5',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    backgroundColor: '#fff',
    marginTop: 8,
    marginBottom: 10,
  },
  pickerChipRowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 8,
  },
  pickerChipRowLeft: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, flex: 1, minWidth: 0 },
  pickerChipFilterBtn: { flexShrink: 0, marginLeft: 4 },
  pickerChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#e2ddd5',
    backgroundColor: '#fff',
  },
  pickerChipText: { fontSize: 13, color: '#444', fontWeight: '600' },
  pickerList: { paddingBottom: 30 },
  pickerRow: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2ddd5',
    backgroundColor: '#fff',
    marginBottom: 8,
  },
  leftoversRow: { backgroundColor: '#fdf0e9' },
  pickerRowTitle: { fontSize: 15, fontWeight: '700', color: '#1a1a1a' },
  pickerRowMeta: { fontSize: 12, color: '#666', marginTop: 3 },
  empty: { padding: 14, color: '#666' },

  pickerFiltersSheet: {
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
  pickerFiltersSheetTitle: { fontSize: 20, fontWeight: '800', color: '#1a1a1a', marginBottom: 4 },
  pickerFiltersSheetScroll: { maxHeight: 480 },
  pickerFiltersSheetScrollInner: { paddingBottom: 8 },
  pickerFilterSubLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
    marginTop: 4,
    marginBottom: 2,
  },
  pickerTimeSliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 4,
    paddingBottom: 10,
  },
  pickerTimeSliderCol: { flex: 1, minWidth: 0 },
  pickerTimeSlider: { width: '100%', height: 36 },
  pickerTimeSliderValue: { fontSize: 12, color: '#666', fontWeight: '600', marginTop: -2 },
  pickerTimeSliderResetBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#e2ddd5',
    backgroundColor: '#fff',
  },
  pickerTimeSliderResetBtnOff: { backgroundColor: '#f7f6f3', borderColor: '#eee9e1' },
  pickerTimeSliderResetText: { fontSize: 13, color: '#444', fontWeight: '700' },
  pickerTimeSliderResetTextOff: { color: '#9a958d' },
  pickerChipScroll: { marginBottom: 6 },
  pickerChipRow: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    gap: 8,
    paddingVertical: 4,
    alignItems: 'center',
  },
  pickerTagsMoreChip: { borderStyle: 'dashed', borderColor: '#c9c2b8' },
  pickerTagsMoreChipText: { fontWeight: '700' },
  pickerFiltersSheetActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 12,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e2ddd5',
  },
  pickerFilterClearAllBtn: { paddingVertical: 12, paddingHorizontal: 8, flex: 1 },
  pickerFilterClearAllText: {
    color: '#9a3d3d',
    fontWeight: '700',
    fontSize: 16,
    textAlign: 'center',
  },
  pickerFilterDoneBtn: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 10,
    minWidth: 120,
    alignItems: 'center',
  },
  pickerFilterDoneBtnText: { color: '#fff', fontWeight: '800', fontSize: 16 },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: 24,
  },
  tagPickerCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    maxHeight: '88%',
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
  },
  modalTitle: { fontSize: 20, fontWeight: '700', marginBottom: 12 },
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

  newRecipeActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
    flexWrap: 'wrap',
  },
  newRecipeBadge: { fontSize: 12, fontWeight: '900', color: '#2a4a7a' },
  newRecipeApproveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1.5,
    backgroundColor: '#fff',
  },
  newRecipeApproveText: { fontSize: 13, fontWeight: '800' },
  newRecipeOtherBtn: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    backgroundColor: '#fff',
  },
  newRecipeOtherText: { fontSize: 13, fontWeight: '800', color: '#444' },

  replaceBackdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  replaceBackdropPress: { ...StyleSheet.absoluteFill },
  replaceCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 18,
    borderWidth: 1,
    borderColor: '#e2ddd5',
  },
  replaceTitle: { fontSize: 18, fontWeight: '800', color: '#1a1a1a', marginBottom: 6 },
  replaceHint: { fontSize: 13, color: '#666', lineHeight: 18, marginBottom: 10 },
  replaceInput: {
    borderWidth: 1,
    borderColor: '#e2ddd5',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    backgroundColor: '#fff',
    minHeight: 80,
    textAlignVertical: 'top',
  },
  replaceActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
    gap: 12,
  },
  replaceCancel: { padding: 10 },
  replaceCancelText: { color: '#666', fontSize: 16, fontWeight: '600' },
  replaceAskBtn: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
    minWidth: 120,
    alignItems: 'center',
  },
  replaceAskBtnText: { color: '#fff', fontWeight: '800', fontSize: 16 },

  previewRoot: { flex: 1, paddingHorizontal: 14 },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingBottom: 6,
  },
  previewTitle: { fontSize: 18, fontWeight: '900', color: '#1a1a1a' },
  previewMeta: { fontSize: 12, color: '#666', marginTop: 2 },
  previewClose: { fontSize: 16, fontWeight: '700' },
  previewScrollView: { flex: 1 },
  previewFooter: {
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#ddd',
  },
  previewGoBtn: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
  },
  previewGoBtnText: { fontSize: 16, fontWeight: '800' },
  previewLoadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14 },
  previewLoadingText: { fontSize: 14, color: '#666' },
  previewErrorWrap: { flex: 1, justifyContent: 'center', paddingVertical: 24, gap: 14 },
  previewErrorText: { fontSize: 15, color: '#666', textAlign: 'center', lineHeight: 22 },
  previewRetryBtn: {
    alignSelf: 'center',
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 12,
    borderWidth: 1,
  },
  previewRetryBtnText: { fontSize: 15, fontWeight: '800' },
  previewScroll: { paddingBottom: 24 },
  previewImage: {
    width: '100%',
    height: 180,
    borderRadius: 12,
    backgroundColor: '#e8e4dc',
    marginTop: 10,
    marginBottom: 12,
  },
  previewSectionTitle: {
    fontSize: 15,
    fontWeight: '900',
    color: '#1a1a1a',
    marginTop: 8,
    marginBottom: 6,
  },
  previewEmpty: { fontSize: 14, color: '#666', paddingVertical: 6 },
  previewGroup: { marginBottom: 10 },
  previewGroupTitle: { fontSize: 13, fontWeight: '800', color: '#555', marginBottom: 4 },
  previewLine: { fontSize: 14, color: '#1a1a1a', lineHeight: 20, marginBottom: 3 },
});
