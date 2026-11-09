import { useFocusEffect, Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  Share,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Ionicons } from '@expo/vector-icons';
import { useConfirmDialog } from '../../../components/ConfirmDialog';
import { PortionScaler } from '../../../components/PortionScaler';
import { RecipeAdjustChat } from '../../../components/RecipeAdjustChat';
import { ScaledIngredientsList } from '../../../components/ScaledIngredientsList';
import { useAppTheme } from '../../../components/ThemeContext';
import {
  assessProduceLocalityAndPesticides,
  finalizeBioScoreFromAssessment,
  recomputeBioScoreFromPreparedItems,
} from '../../../lib/bioScore';
import { addToBioScoreExcludeList } from '../../../lib/bioScoreExcludePrefs';
import { isBioScoreEnabled } from '../../../lib/bioScoreEnabledPrefs';
import { ensureDatabaseAsync } from '../../../lib/db';
import { checkHasInternet } from '../../../lib/internetCheck';
import { getRecipeListMembership, setRecipeInList } from '../../../lib/listsRepo';
import { effectiveBaseServings, servingFactor } from '../../../lib/scaling';
import {
  deleteRecipe,
  getFullRecipe,
  listRecipeVersions,
  restoreRecipeFromVersion,
  setRecipeFavoriteFlag,
  updateRecipeLastOpened,
} from '../../../lib/recipesRepo';
import { formatStepTimerNl } from '../../../lib/timerFormat';
import { getShoppingStaplesExcludeList } from '../../../lib/shoppingStaplesPrefs';
import {
  isStaple,
  mergeAggregatedShoppingItems,
  type AggregatedShoppingItemInput,
} from '../../../lib/shopping';
import { insertWeekShoppingItems } from '../../../lib/shoppingRepo';
import type { FullRecipe } from '../../../lib/types';

export default function RecipeDetailScreen() {
  const theme = useAppTheme();
  const { confirm, ConfirmDialog } = useConfirmDialog();
  const { id: idParam, openLists } = useLocalSearchParams<{ id: string; openLists?: string }>();
  const router = useRouter();
  const recipeId = Number.parseInt(idParam ?? '', 10);
  const [recipeTick, setRecipeTick] = useState(0);
  const [recipe, setRecipe] = useState<FullRecipe | null>(null);
  const [detailLoading, setDetailLoading] = useState(true);

  const [listRows, setListRows] = useState<{ id: number; name: string; member: boolean }[]>([]);
  const [servings, setServings] = useState(4);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [listsModalOpen, setListsModalOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyRows, setHistoryRows] = useState<
    { id: number; versionNumber: number; note: string | null; createdAt: string }[]
  >([]);
  const [bioDetailsOpen, setBioDetailsOpen] = useState(false);
  const [bioRecomputeBusy, setBioRecomputeBusy] = useState(false);
  const [bioEnabled, setBioEnabled] = useState(isBioScoreEnabled());

  /** Eerste focus per recept: alleen `useEffect` laadt data; volgende focus = verversen (o.a. na bewerken). */
  const recipeDetailInitialFocus = useRef(true);

  useEffect(() => {
    if (!Number.isFinite(recipeId)) return;
    let cancelled = false;
    void (async () => {
      setDetailLoading(true);
      const r = await getFullRecipe(recipeId);
      if (cancelled) return;
      setRecipe(r);
      if (r) setServings(effectiveBaseServings(r.baseServings));
      setDetailLoading(false);
      // Update last_opened_at timestamp whenever a recipe is viewed
      if (r) {
        try {
          await updateRecipeLastOpened(recipeId);
        } catch (e) {
          console.error('Failed to update last_opened_at:', e);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [recipeId, recipeTick]);

  useEffect(() => {
    recipeDetailInitialFocus.current = true;
  }, [recipeId]);

  const refreshLists = useCallback(() => {
    if (!Number.isFinite(recipeId)) return;
    void getRecipeListMembership(recipeId)
      .then(setListRows)
      .catch(() => setListRows([]));
  }, [recipeId]);

  useFocusEffect(
    useCallback(() => {
      setBioEnabled(isBioScoreEnabled());
      refreshLists();
      if (recipeDetailInitialFocus.current) {
        recipeDetailInitialFocus.current = false;
        if (openLists === '1') {
          // Let UI mount before opening.
          setTimeout(() => setListsModalOpen(true), 0);
        }
        return;
      }
      setRecipeTick((t) => t + 1);
    }, [refreshLists])
  );

  const onAdjustApplied = useCallback(() => {
    setRecipeTick((t) => t + 1);
    refreshLists();
  }, [refreshLists]);

  const toggleFavorite = useCallback(() => {
    if (!recipe) return;
    const next = !recipe.isFavorite;
    void (async () => {
      await setRecipeFavoriteFlag(recipeId, next);
      setRecipe((r) => (r && r.id === recipeId ? { ...r, isFavorite: next } : r));
    })();
  }, [recipe, recipeId]);

  const onShare = useCallback(() => {
    if (!recipe) return;
    const lines: string[] = [];
    lines.push(recipe.title);
    if (recipe.category) lines.push(`Categorie: ${recipe.category}`);
    if (recipe.totalTimeMin != null) lines.push(`Tijd: ${recipe.totalTimeMin} min`);
    if (recipe.baseServings != null) lines.push(`Basisporties: ${recipe.baseServings}`);
    if (recipe.tags.length) lines.push(`Tags: ${recipe.tags.join(', ')}`);
    if (recipe.sourceUrl) lines.push(`Bron: ${recipe.sourceUrl}`);
    lines.push('');
    if (recipe.description) {
      lines.push(recipe.description);
      lines.push('');
    }
    lines.push('Ingrediënten');
    for (const g of recipe.ingredientGroups) {
      if (g.title) lines.push(g.title);
      for (const ing of g.ingredients) {
        const qty =
          ing.amount != null && Number.isFinite(ing.amount)
            ? `${ing.amount}${ing.unit ? ` ${ing.unit}` : ''}`
            : ing.unit
              ? ing.unit
              : '';
        lines.push(`- ${qty ? `${qty} ` : ''}${ing.name}`.trim());
      }
    }
    lines.push('');
    lines.push('Stappen');
    let stepNo = 1;
    for (const sec of recipe.stepSections) {
      if (sec.title) lines.push(sec.title);
      for (const st of sec.steps) {
        const t = st.timerSeconds != null ? ` (${formatStepTimerNl(st.timerSeconds)})` : '';
        lines.push(`${stepNo}. ${st.description}${t}`);
        stepNo += 1;
      }
      lines.push('');
    }

    void (async () => {
      try {
        await Share.share({ title: recipe.title, message: lines.join('\n') });
      } catch (e) {
        Alert.alert('Fout', e instanceof Error ? e.message : 'Delen mislukt.');
      }
    })();
  }, [recipe]);

  const onDelete = useCallback(() => {
    void (async () => {
      const ok = await confirm({
        title: 'Recept verwijderen',
        message: 'Weet je zeker dat je dit recept wilt verwijderen?',
        confirmText: 'Verwijderen',
        cancelText: 'Annuleren',
        destructive: true,
      });
      if (!ok) return;
      await deleteRecipe(recipeId);
      router.replace('/(tabs)/recipes');
    })();
  }, [confirm, recipeId, router]);

  const addRecipeToShopping = useCallback(async () => {
    if (!recipe) return;

    const staplesExclude = getShoppingStaplesExcludeList();

    const allIngredients: AggregatedShoppingItemInput[] = [];
    for (const group of recipe.ingredientGroups) {
      for (const ing of group.ingredients) {
        const name = ing.name.trim();
        if (!name) continue;
        if (isStaple(name, staplesExclude)) continue;

        allIngredients.push({
          name,
          amount: ing.amount,
          unit: ing.unit ?? null,
        });
      }
    }

    if (allIngredients.length === 0) {
      Alert.alert(
        'Geen ingrediënten',
        'Dit recept heeft geen niet-staple ingrediënten om toe te voegen.'
      );
      return;
    }

    const factor = servingFactor(servings, recipe.baseServings);
    const scaledIngredients = allIngredients.map((ing) => ({
      name: ing.name,
      amount: ing.amount !== null ? ing.amount * factor : null,
      unit: ing.unit,
    }));

    const merged = mergeAggregatedShoppingItems(scaledIngredients);
    await insertWeekShoppingItems(merged);

    Alert.alert(
      'Toegevoegd',
      `${merged.length} ingrediënt(en) toegevoegd aan je boodschappenlijst.`
    );
  }, [recipe, servings]);

  const openHistory = useCallback(() => {
    if (!Number.isFinite(recipeId)) return;
    setHistoryOpen(true);
    setHistoryLoading(true);
    void (async () => {
      try {
        setHistoryRows(await listRecipeVersions(recipeId));
      } finally {
        setHistoryLoading(false);
      }
    })();
  }, [recipeId]);

  const formatHistoryDate = useCallback((iso: string) => {
    const dt = new Date(iso);
    if (Number.isNaN(dt.getTime())) return iso;
    return dt.toLocaleString('nl-NL', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }, []);

  if (!Number.isFinite(recipeId)) {
    return (
      <View style={styles.center}>
        <Text>Ongeldig recept.</Text>
      </View>
    );
  }

  if (detailLoading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator size="large" color={theme.accent} />
      </View>
    );
  }

  const selectedLists = listRows.filter((r) => r.member);

  if (!recipe) {
    return (
      <View style={styles.center}>
        <Text>Recept niet gevonden.</Text>
        <Link href="/" asChild>
          <Pressable style={styles.linkBtn}>
            <Text style={styles.linkBtnText}>Terug naar recepten</Text>
          </Pressable>
        </Link>
      </View>
    );
  }

  const metaChips: { key: string; label: string; variant: 'accent' | 'neutral' }[] = [];
  if (recipe.wantToTry) metaChips.push({ key: 'try', label: 'Wil proberen', variant: 'accent' });
  if (recipe.category) metaChips.push({ key: 'cat', label: recipe.category, variant: 'neutral' });
  if (recipe.baseServings != null) {
    metaChips.push({ key: 'srv', label: `${recipe.baseServings} porties`, variant: 'neutral' });
  }
  if (recipe.prepTimeMin != null) {
    metaChips.push({
      key: 'prep',
      label: `Voorbereiding ${recipe.prepTimeMin} min`,
      variant: 'neutral',
    });
  }
  if (recipe.cookTimeMin != null) {
    metaChips.push({ key: 'cook', label: `Koken ${recipe.cookTimeMin} min`, variant: 'neutral' });
  }
  if (recipe.totalTimeMin != null) {
    metaChips.push({ key: 'tot', label: `Totaal ${recipe.totalTimeMin} min`, variant: 'neutral' });
  }
  return (
    <>
      <ConfirmDialog />
      <ScrollView
        contentContainerStyle={styles.scroll}
        style={[styles.flex, { backgroundColor: theme.background }]}
      >
        {recipe.imageUri ? (
          <Image
            source={{ uri: recipe.imageUri }}
            style={styles.coverImage}
            resizeMode="cover"
            accessibilityLabel="Receptfoto"
          />
        ) : null}
        <View style={styles.titleRow}>
          <Text style={styles.title}>{recipe.title}</Text>
          {bioEnabled && recipe.bioScoreColor ? (
            <Pressable
              style={styles.titleLeafWrap}
              onPress={() => setBioDetailsOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Bio-score details openen"
              hitSlop={8}
            >
              <Ionicons
                name="leaf"
                size={20}
                color={
                  recipe.bioScoreColor === 'green'
                    ? '#2e7d32'
                    : recipe.bioScoreColor === 'red'
                      ? '#b00020'
                      : theme.accent
                }
                accessibilityLabel={
                  recipe.bioScoreColor === 'green'
                    ? 'Bio-score: groen'
                    : recipe.bioScoreColor === 'red'
                      ? 'Bio-score: rood'
                      : 'Bio-score: oranje'
                }
              />
            </Pressable>
          ) : null}
          <Pressable
            style={styles.titleFavBtn}
            hitSlop={10}
            onPress={toggleFavorite}
            accessibilityRole="button"
            accessibilityState={{ selected: recipe.isFavorite }}
            accessibilityLabel={
              recipe.isFavorite ? 'Verwijderen uit favorieten' : 'Toevoegen aan favorieten'
            }
          >
            <Ionicons
              name={recipe.isFavorite ? 'heart' : 'heart-outline'}
              size={24}
              color={recipe.isFavorite ? theme.accent : '#9a958d'}
              accessibilityElementsHidden
              importantForAccessibility="no"
            />
          </Pressable>
        </View>
        <View style={styles.metaRowOuter}>
          <View style={styles.metaChipsWrap}>
            {metaChips.map((c) => (
              <View
                key={c.key}
                style={
                  c.variant === 'accent'
                    ? [
                        styles.metaChip,
                        { borderColor: theme.accentBorderMuted, backgroundColor: theme.accentSoft },
                      ]
                    : styles.metaChip
                }
              >
                <Text
                  style={
                    c.variant === 'accent'
                      ? [styles.metaChipText, { color: theme.accent, fontWeight: '700' as const }]
                      : styles.metaChipText
                  }
                >
                  {c.label}
                </Text>
              </View>
            ))}
            {recipe.tags.map((tag, i) => (
              <View key={`tag-${i}`} style={styles.metaChip}>
                <Text style={styles.metaChipText}>{tag}</Text>
              </View>
            ))}
          </View>
          <Pressable
            style={[
              styles.listsCountBtn,
              styles.listsCountBtnTall,
              listRows.length === 0 && styles.listsCountBtnMuted,
            ]}
            onPress={() => setListsModalOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={`Lijsten, ${selectedLists.length} van ${listRows.length}`}
          >
            <Text style={styles.listsCountNum}>{selectedLists.length}</Text>
            <Text style={styles.listsCountLabel}>lijsten</Text>
          </Pressable>
        </View>
        {recipe.description ? <Text style={styles.body}>{recipe.description}</Text> : null}

        <View style={styles.toolsRow}>
          <PortionScaler
            compact
            baseServings={recipe.baseServings}
            value={servings}
            onChange={setServings}
          />
          <Pressable
            style={[styles.shareOutlineBtn, { borderColor: theme.accentBorderMuted }]}
            onPress={onShare}
            accessibilityRole="button"
            accessibilityLabel="Recept delen"
          >
            <Text style={[styles.shareOutlineBtnText, { color: theme.accent }]}>Delen</Text>
          </Pressable>
          <Pressable
            style={[styles.aiOutlineBtn, { borderColor: theme.accent }]}
            onPress={() => setAdjustOpen(true)}
          >
            <Text style={[styles.aiOutlineBtnText, { color: theme.accent }]} numberOfLines={2}>
              Recept aanpassen met AI
            </Text>
          </Pressable>
        </View>

        {bioEnabled &&
        recipe.bioScoreColor &&
        recipe.bioScoreItems &&
        recipe.bioScoreItems.length > 0 ? (
          <Pressable
            style={[styles.bioDetailsBtn, { borderColor: theme.accentBorderMuted }]}
            onPress={() => setBioDetailsOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Waarom deze bio-score?"
          >
            <Text style={[styles.bioDetailsBtnText, { color: theme.accent }]}>
              Waarom deze bio-score?
            </Text>
          </Pressable>
        ) : null}

        <ScaledIngredientsList
          recipe={recipe}
          targetServings={servings}
          headerRight={
            <Pressable
              style={[styles.addToShoppingBtn, { borderColor: theme.accent }]}
              onPress={addRecipeToShopping}
              accessibilityRole="button"
              accessibilityLabel="Alle ingrediënten toevoegen aan boodschappenlijst"
              hitSlop={10}
            >
              <Ionicons name="cart-outline" size={22} color={theme.accent} />
            </Pressable>
          }
        />

        {recipe.notes ? (
          <View style={styles.notesBox}>
            <Text style={styles.notesLabel}>Notities</Text>
            <Text style={styles.notesBody}>{recipe.notes}</Text>
          </View>
        ) : null}

        <Text style={[styles.stepsScreenTitle, { color: theme.accent }]}>Stappen</Text>
        {recipe.stepSections.map((section) => (
          <View key={section.id} style={styles.stepSection}>
            {section.title ? <Text style={styles.stepSectionHeading}>{section.title}</Text> : null}
            {section.steps.map((st, idx) => (
              <View key={st.id} style={styles.stepBlock}>
                <Text style={styles.stepLine}>
                  <Text style={[styles.stepIndex, { color: theme.accent }]}>{idx + 1}. </Text>
                  {st.description}
                </Text>
                {st.timerSeconds != null && st.timerSeconds > 0 ? (
                  <Text style={styles.stepTimer}>Timer: {formatStepTimerNl(st.timerSeconds)}</Text>
                ) : null}
              </View>
            ))}
          </View>
        ))}

        <Modal visible={listsModalOpen} animationType="fade" transparent>
          <View style={styles.listsModalRoot}>
            <Pressable style={styles.listsModalBackdrop} onPress={() => setListsModalOpen(false)} />
            <View style={[styles.listsModalCard, { backgroundColor: theme.background }]}>
              <Text style={styles.listsModalTitle}>Lijsten voor dit recept</Text>
              <ScrollView
                style={styles.listsModalScroll}
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled
              >
                {listRows.length === 0 ? (
                  <Text style={styles.listsModalEmpty}>
                    Nog geen lijsten. Maak er een aan op de receptenpagina.
                  </Text>
                ) : null}
                {listRows.map((row) => (
                  <Pressable
                    key={row.id}
                    style={styles.listPickRow}
                    onPress={() => {
                      void (async () => {
                        await setRecipeInList(row.id, recipeId, !row.member);
                        refreshLists();
                      })();
                    }}
                  >
                    <Text style={[styles.listPickCheck, { color: theme.accent }]}>
                      {row.member ? '☑' : '☐'}
                    </Text>
                    <Text style={styles.listPickText} numberOfLines={2}>
                      {row.name}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
              <Pressable
                style={[styles.listsModalClose, { backgroundColor: theme.accent }]}
                onPress={() => setListsModalOpen(false)}
              >
                <Text style={styles.listsModalCloseText}>Sluiten</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        <View style={styles.actions}>
          <Link href={`/recipe/cook/${recipeId}`} asChild>
            <Pressable
              style={StyleSheet.flatten([styles.primaryBtn, { backgroundColor: theme.accent }])}
            >
              <Text style={styles.primaryBtnText}>Kookmodus</Text>
            </Pressable>
          </Link>
          <Pressable
            style={StyleSheet.flatten([styles.secondaryBtn, { borderColor: theme.accent }])}
            onPress={openHistory}
          >
            <Text style={[styles.secondaryBtnText, { color: theme.accent }]}>Geschiedenis</Text>
          </Pressable>
          <Link href={`/recipe/${recipeId}/edit`} asChild>
            <Pressable
              style={StyleSheet.flatten([styles.secondaryBtn, { borderColor: theme.accent }])}
            >
              <Text style={[styles.secondaryBtnText, { color: theme.accent }]}>Bewerken</Text>
            </Pressable>
          </Link>
          <Pressable style={styles.dangerBtn} onPress={onDelete}>
            <Text style={styles.dangerBtnText}>Verwijderen</Text>
          </Pressable>
        </View>
      </ScrollView>

      <Modal
        visible={historyOpen}
        animationType="fade"
        transparent
        onRequestClose={() => setHistoryOpen(false)}
      >
        <View style={styles.historyRoot}>
          <Pressable style={styles.historyBackdrop} onPress={() => setHistoryOpen(false)} />
          <View style={[styles.historyCard, { backgroundColor: theme.background }]}>
            <Text style={styles.historyTitle}>Geschiedenis</Text>
            {historyLoading ? (
              <ActivityIndicator color={theme.accent} style={{ marginTop: 10 }} />
            ) : null}
            {!historyLoading && historyRows.length === 0 ? (
              <Text style={styles.historyEmpty}>Nog geen opgeslagen versies.</Text>
            ) : null}
            <ScrollView
              style={styles.historyScroll}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
            >
              {historyRows.map((row) => (
                <View key={row.id} style={styles.historyRow}>
                  <View style={styles.historyRowMain}>
                    <Text style={styles.historyRowTitle} numberOfLines={2}>
                      Versie {row.versionNumber}
                    </Text>
                    <Text style={styles.historyRowMeta} numberOfLines={1}>
                      {formatHistoryDate(row.createdAt)}
                      {row.note?.trim() ? ` · ${row.note.trim()}` : ''}
                    </Text>
                  </View>
                  <Pressable
                    style={StyleSheet.flatten([
                      styles.historyRestoreBtn,
                      { borderColor: theme.accent },
                    ])}
                    onPress={() => {
                      void (async () => {
                        const ok = await confirm({
                          title: 'Terugzetten?',
                          message:
                            'De huidige versie wordt eerst opgeslagen als snapshot (\"Vóór terugzetten\").',
                          confirmText: 'Terugzetten',
                          cancelText: 'Annuleren',
                          destructive: true,
                        });
                        if (!ok) return;
                        try {
                          await restoreRecipeFromVersion({ recipeId, versionId: row.id });
                          setHistoryOpen(false);
                          setRecipeTick((t) => t + 1);
                        } catch (e) {
                          Alert.alert(
                            'Terugzetten mislukt',
                            e instanceof Error ? e.message : 'Onbekende fout.'
                          );
                        }
                      })();
                    }}
                  >
                    <Text style={[styles.historyRestoreText, { color: theme.accent }]}>
                      Terugzetten
                    </Text>
                  </Pressable>
                </View>
              ))}
            </ScrollView>
            <Pressable
              style={StyleSheet.flatten([
                styles.listsModalClose,
                { backgroundColor: theme.accent },
              ])}
              onPress={() => setHistoryOpen(false)}
            >
              <Text style={styles.listsModalCloseText}>Sluiten</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <RecipeAdjustChat
        recipe={recipe}
        recipeId={recipeId}
        visible={adjustOpen}
        onClose={() => setAdjustOpen(false)}
        onApplied={onAdjustApplied}
      />

      <Modal
        visible={bioEnabled && bioDetailsOpen}
        animationType="slide"
        onRequestClose={() => setBioDetailsOpen(false)}
      >
        <View style={[styles.modalWrap, { backgroundColor: theme.background }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Bio-score details</Text>
            <Pressable
              style={[
                styles.modalClosePill,
                { borderColor: theme.accentBorderMuted },
                bioRecomputeBusy && styles.modalPillDisabled,
              ]}
              onPress={() => {
                if (bioRecomputeBusy) return;
                setBioRecomputeBusy(true);
                void (async () => {
                  try {
                    const ok = await checkHasInternet();
                    if (!ok) {
                      Alert.alert(
                        'Geen internet',
                        'Bio score herberekenen vereist internetverbinding.'
                      );
                      return;
                    }
                    const r = recipe;
                    const ingNames: string[] = [];
                    for (const g of r.ingredientGroups) {
                      for (const i of g.ingredients) {
                        if (i.name?.trim()) ingNames.push(i.name.trim());
                      }
                    }
                    const assessed = await assessProduceLocalityAndPesticides(ingNames);
                    if (!assessed.ok) {
                      Alert.alert('Fout', assessed.message);
                      return;
                    }
                    const { items, color } = await finalizeBioScoreFromAssessment(assessed.items);
                    const now = new Date().toISOString();
                    const db = await ensureDatabaseAsync();
                    await db.runAsync(
                      'UPDATE recipes SET bio_score_color = ?, bio_score_updated_at = ?, bio_score_items_json = ?, updated_at = ? WHERE id = ?',
                      [color, now, JSON.stringify(items), now, recipeId]
                    );
                    setRecipeTick((t) => t + 1);
                  } catch (e) {
                    Alert.alert(
                      'Fout',
                      e instanceof Error ? e.message : 'Bio score herberekenen mislukt.'
                    );
                  } finally {
                    setBioRecomputeBusy(false);
                  }
                })();
              }}
              disabled={bioRecomputeBusy}
              accessibilityRole="button"
              accessibilityLabel="Bio score herberekenen"
            >
              <Text style={[styles.modalClosePillText, { color: theme.accent }]}>
                {bioRecomputeBusy ? 'Herberekenen…' : 'Herberekenen'}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.modalClosePill, { borderColor: theme.accentBorderMuted }]}
              onPress={() => setBioDetailsOpen(false)}
            >
              <Text style={[styles.modalClosePillText, { color: theme.accent }]}>Sluiten</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.modalContent}>
            {recipe.bioScoreUpdatedAt ? (
              <Text style={styles.modalHint}>
                Laatst berekend: {new Date(recipe.bioScoreUpdatedAt).toLocaleDateString('nl-NL')}
              </Text>
            ) : null}

            {!recipe.bioScoreItems || recipe.bioScoreItems.length === 0 ? (
              <Text style={styles.modalHint}>
                Nog geen details opgeslagen. Druk op “Herberekenen” om uitleg op te slaan.
              </Text>
            ) : null}

            {(recipe.bioScoreItems ?? []).map((it, idx) => (
              <View key={`${it.n}-${idx}`} style={styles.bioRow}>
                <View style={styles.bioRowMain}>
                  <Text style={styles.bioName}>{it.n}</Text>
                  <View style={styles.bioBadges}>
                    <Text
                      style={[
                        styles.bioBadge,
                        it.l === 'G'
                          ? styles.bioBadgeGreen
                          : it.l === 'O'
                            ? styles.bioBadgeOrange
                            : styles.bioBadgeRed,
                      ]}
                    >
                      herkomst {it.l}
                    </Text>
                    <Text
                      style={[
                        styles.bioBadge,
                        it.p === 'L'
                          ? styles.bioBadgeGreen
                          : it.p === 'M'
                            ? styles.bioBadgeOrange
                            : styles.bioBadgeRed,
                      ]}
                    >
                      pesticide {it.p}
                    </Text>
                  </View>
                </View>
                <Pressable
                  style={[styles.bioExcludeBtn, { borderColor: theme.accentBorderMuted }]}
                  onPress={() => {
                    void (async () => {
                      try {
                        await addToBioScoreExcludeList(it.n);
                        const { items, color } = await recomputeBioScoreFromPreparedItems(
                          recipe.bioScoreItems ?? []
                        );
                        const now = new Date().toISOString();
                        const db = await ensureDatabaseAsync();
                        await db.runAsync(
                          'UPDATE recipes SET bio_score_color = ?, bio_score_updated_at = ?, bio_score_items_json = ?, updated_at = ? WHERE id = ?',
                          [color, now, JSON.stringify(items), now, recipeId]
                        );
                        setRecipeTick((t) => t + 1);
                      } catch (e) {
                        Alert.alert(
                          'Fout',
                          e instanceof Error ? e.message : 'Ingredient uitsluiten mislukt.'
                        );
                      }
                    })();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${it.n} uitsluiten van bio-score`}
                >
                  <Text style={[styles.bioExcludeBtnText, { color: theme.accent }]}>
                    Verwijder uit berekening
                  </Text>
                </Pressable>
              </View>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { padding: 20, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  coverImage: {
    width: '100%',
    height: 220,
    borderRadius: 12,
    backgroundColor: '#e8e4dc',
    marginBottom: 16,
  },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 8 },
  titleLeafWrap: { paddingTop: 2 },
  title: {
    flex: 1,
    minWidth: 0,
    fontSize: 26,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  titleFavBtn: { paddingTop: 2 },
  metaRowOuter: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 4,
  },
  metaChipsWrap: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  metaChip: {
    borderWidth: 1,
    borderColor: '#e2ddd5',
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
  },
  metaChipText: { fontSize: 13, fontWeight: '600', color: '#444' },
  body: { fontSize: 16, lineHeight: 24, color: '#333', marginTop: 12 },
  notesBox: {
    marginTop: 16,
    padding: 12,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2ddd5',
  },
  notesLabel: { fontWeight: '700', marginBottom: 6, color: '#444' },
  notesBody: { fontSize: 16, lineHeight: 24, color: '#333' },
  listsCountBtn: {
    borderWidth: 1,
    borderColor: '#e2ddd5',
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 12,
    minWidth: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** Twee chip-rijen hoog, rechts naast tags. */
  listsCountBtnTall: {
    minHeight: 78,
    paddingVertical: 8,
    alignSelf: 'flex-start',
  },
  listsCountBtnMuted: { opacity: 0.55 },
  listsCountNum: { fontSize: 18, fontWeight: '700', color: '#1a1a1a', lineHeight: 22 },
  listsCountLabel: { fontSize: 11, fontWeight: '600', color: '#666', marginTop: 2 },
  toolsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
    marginBottom: 8,
  },
  bioDetailsBtn: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  bioDetailsBtnText: { fontSize: 14, fontWeight: '700' },
  modalWrap: { flex: 1 },
  modalHeader: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  modalTitle: { fontSize: 18, fontWeight: '800', color: '#1a1a1a', flex: 1, minWidth: 0 },
  modalClosePill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  modalPillDisabled: { opacity: 0.6 },
  modalClosePillText: { fontSize: 14, fontWeight: '700' },
  modalContent: { padding: 16, paddingBottom: 40 },
  modalHint: { fontSize: 13, color: '#666', marginBottom: 12 },
  bioRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 14,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2ddd5',
  },
  bioRowMain: { flex: 1, minWidth: 0 },
  bioName: { fontSize: 15, fontWeight: '700', color: '#1a1a1a', marginBottom: 6 },
  bioExcludeBtn: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 8,
    maxWidth: 118,
  },
  bioExcludeBtnText: { fontSize: 11, fontWeight: '700', lineHeight: 15, textAlign: 'center' },
  bioBadges: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  bioBadge: {
    borderWidth: 1,
    borderColor: '#e2ddd5',
    backgroundColor: '#fff',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    fontSize: 13,
    fontWeight: '700',
    color: '#444',
  },
  bioBadgeGreen: { borderColor: '#b8d7c6', backgroundColor: '#f0f4ef', color: '#2d4a2d' },
  bioBadgeOrange: { borderColor: '#e2c5b5', backgroundColor: '#fdf0e9', color: '#7a3b20' },
  bioBadgeRed: { borderColor: '#e6bcbc', backgroundColor: '#fff0f0', color: '#7a2020' },
  stepsScreenTitle: {
    fontSize: 17,
    fontWeight: '700',
    marginTop: 16,
    marginBottom: 8,
  },
  stepSection: { marginBottom: 16 },
  stepSectionHeading: { fontSize: 14, fontWeight: '600', color: '#555', marginBottom: 8 },
  stepBlock: { marginBottom: 12 },
  stepLine: { fontSize: 16, lineHeight: 24, color: '#1a1a1a' },
  stepIndex: { fontWeight: '700' },
  stepTimer: { fontSize: 13, color: '#666', marginTop: 4 },
  listsModalRoot: { flex: 1, justifyContent: 'center', padding: 24 },
  listsModalBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  listsModalCard: {
    borderRadius: 12,
    padding: 20,
    maxHeight: '85%',
    borderWidth: 1,
    borderColor: '#e2ddd5',
  },
  listsModalTitle: { fontSize: 18, fontWeight: '700', marginBottom: 12, color: '#1a1a1a' },
  listsModalEmpty: { fontSize: 14, color: '#666', lineHeight: 20, marginBottom: 8 },
  listsModalScroll: { maxHeight: 320 },
  listPickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#e8e4dc',
  },
  listPickCheck: { fontSize: 20, width: 28, textAlign: 'center' },
  listPickText: { flex: 1, fontSize: 16, color: '#1a1a1a' },
  listsModalClose: {
    marginTop: 16,
    alignSelf: 'flex-end',
    paddingVertical: 12,
    paddingHorizontal: 22,
    borderRadius: 10,
  },
  listsModalCloseText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  actions: { marginTop: 28, gap: 12 },
  primaryBtn: {
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  secondaryBtn: {
    borderWidth: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  secondaryBtnText: { fontWeight: '700', fontSize: 16 },
  dangerBtn: { paddingVertical: 12, alignItems: 'center' },
  dangerBtnText: { color: '#b00020', fontWeight: '600', fontSize: 16 },
  linkBtn: { marginTop: 16 },
  linkBtnText: { color: '#2a6cb6', fontSize: 16 },
  aiOutlineBtn: {
    flex: 1,
    minWidth: 0,
    borderWidth: 1.5,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiOutlineBtnText: { fontWeight: '700', fontSize: 14, textAlign: 'center' },
  shareOutlineBtn: {
    borderWidth: 1.5,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareOutlineBtnText: { fontWeight: '800', fontSize: 14, textAlign: 'center' },
  addToShoppingBtn: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 8,
  },

  historyRoot: { flex: 1, justifyContent: 'center', padding: 24 },
  historyBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.4)' },
  historyCard: {
    borderRadius: 12,
    padding: 20,
    maxHeight: '85%',
    borderWidth: 1,
    borderColor: '#e2ddd5',
  },
  historyTitle: { fontSize: 18, fontWeight: '700', marginBottom: 12, color: '#1a1a1a' },
  historyEmpty: { fontSize: 14, color: '#666', lineHeight: 20, marginTop: 6 },
  historyScroll: { maxHeight: 360, marginTop: 8 },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e8e4dc',
  },
  historyRowMain: { flex: 1, minWidth: 0, gap: 2 },
  historyRowTitle: { fontSize: 15, fontWeight: '700', color: '#1a1a1a' },
  historyRowMeta: { fontSize: 12, color: '#666' },
  historyRestoreBtn: {
    borderWidth: 1.5,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#fff',
  },
  historyRestoreText: { fontWeight: '700', fontSize: 13 },
});
