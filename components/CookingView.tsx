import { useKeepAwake } from 'expo-keep-awake';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  type AppStateStatus,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

import { CookingChatPanel } from './CookingChatPanel';
import { PortionScaler } from './PortionScaler';
import { useAppTheme } from './ThemeContext';

import { effectiveBaseServings, formatScaledIngredientLine, servingFactor } from '../lib/scaling';
import type { FullRecipe } from '../lib/types';
import { clearCookProgress, getFullRecipe } from '../lib/recipesRepo';
import { formatStepTimerNl } from '../lib/timerFormat';
import { showTimerFinishedAlert, stopTimerAlarmSoundIfPlaying } from '../lib/timerFinishedAlert';

type Props = {
  recipeId: number;
};

function formatRemain(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

type CheckState = { ing: number[]; step: number[] };

type StepTimerState =
  { status: 'running'; endMs: number } | { status: 'paused'; remainingSec: number };

/** stepId -> timer state (running is wall clock; survives background). */
function remainingSecondsFromEnd(endMs: number): number {
  return Math.max(0, Math.ceil((endMs - Date.now()) / 1000));
}

export function CookingView({ recipeId }: Props) {
  useKeepAwake('cooking');
  const theme = useAppTheme();

  const [recipe, setRecipe] = useState<FullRecipe | null>(null);
  const [checks, setChecks] = useState<CheckState>({ ing: [], step: [] });
  const [servings, setServings] = useState(4);

  const timersByStepIdRef = useRef<Record<number, StepTimerState>>({});
  const [, tick] = useState(0);
  const bump = useCallback(() => tick((x) => x + 1), []);

  const syncTimersFromClock = useCallback((): number => {
    const keys = Object.keys(timersByStepIdRef.current);
    if (keys.length === 0) return 0;
    const now = Date.now();
    let finished = 0;
    const next = { ...timersByStepIdRef.current };
    for (const k of keys) {
      const sid = Number(k);
      const t = next[sid];
      if (!t) continue;
      if (t.status === 'running' && t.endMs <= now) {
        finished += 1;
        delete next[sid];
      }
    }
    timersByStepIdRef.current = next;
    return finished;
  }, []);

  const applyLoadedRecipe = useCallback((r: FullRecipe | null) => {
    setRecipe(r);
    if (!r) return;
    setServings(effectiveBaseServings(r.baseServings));
    setChecks({ ing: [], step: [] });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const r = await getFullRecipe(recipeId);
      if (cancelled) return;
      applyLoadedRecipe(r);
    })();
    return () => {
      cancelled = true;
    };
  }, [recipeId, applyLoadedRecipe]);

  const reload = useCallback(() => {
    void (async () => {
      const r = await getFullRecipe(recipeId);
      applyLoadedRecipe(r);
    })();
  }, [recipeId, applyLoadedRecipe]);

  useEffect(() => {
    return () => {
      void clearCookProgress(recipeId);
      void stopTimerAlarmSoundIfPlaying();
    };
  }, [recipeId]);

  useEffect(() => {
    const id = setInterval(() => {
      if (Object.keys(timersByStepIdRef.current).length === 0) return;
      const finished = syncTimersFromClock();
      bump();
      if (finished > 0) {
        showTimerFinishedAlert(finished);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [bump, syncTimersFromClock]);

  useEffect(() => {
    const onAppState = (state: AppStateStatus) => {
      if (state !== 'active' || Object.keys(timersByStepIdRef.current).length === 0) return;
      const finished = syncTimersFromClock();
      bump();
      if (finished > 0) {
        showTimerFinishedAlert(finished);
      }
    };
    const sub = AppState.addEventListener('change', onAppState);
    return () => sub.remove();
  }, [bump, syncTimersFromClock]);

  const toggleIng = useCallback(
    (id: number) => {
      setChecks((c) => {
        const s = new Set(c.ing);
        if (s.has(id)) s.delete(id);
        else s.add(id);
        const next = { ...c, ing: [...s] };
        return next;
      });
    },
    [recipeId]
  );

  const toggleStep = useCallback(
    (id: number) => {
      setChecks((c) => {
        const s = new Set(c.step);
        if (s.has(id)) s.delete(id);
        else s.add(id);
        const next = { ...c, step: [...s] };
        return next;
      });
    },
    [recipeId]
  );

  const startTimer = useCallback(
    (stepId: number, seconds: number) => {
      timersByStepIdRef.current = {
        ...timersByStepIdRef.current,
        [stepId]: { status: 'running', endMs: Date.now() + seconds * 1000 },
      };
      bump();
    },
    [bump]
  );

  const togglePauseTimer = useCallback(
    (stepId: number) => {
      const cur = timersByStepIdRef.current[stepId];
      if (!cur) return;
      if (cur.status === 'running') {
        const remainingSec = remainingSecondsFromEnd(cur.endMs);
        timersByStepIdRef.current = {
          ...timersByStepIdRef.current,
          [stepId]: { status: 'paused', remainingSec },
        };
      } else {
        timersByStepIdRef.current = {
          ...timersByStepIdRef.current,
          [stepId]: { status: 'running', endMs: Date.now() + cur.remainingSec * 1000 },
        };
      }
      bump();
    },
    [bump]
  );

  const resetTimer = useCallback(
    (stepId: number) => {
      if (!timersByStepIdRef.current[stepId]) return;
      const next = { ...timersByStepIdRef.current };
      delete next[stepId];
      timersByStepIdRef.current = next;
      bump();
    },
    [bump]
  );

  const stepNumberById = useMemo(() => {
    const m = new Map<number, number>();
    if (!recipe) return m;
    let n = 0;
    for (const s of recipe.stepSections) {
      for (const st of s.steps) {
        n += 1;
        m.set(st.id, n);
      }
    }
    return m;
  }, [recipe]);

  if (!recipe) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Recept niet gevonden.</Text>
      </View>
    );
  }

  const ingChecked = new Set(checks.ing);
  const stepChecked = new Set(checks.step);
  const factor = servingFactor(servings, recipe.baseServings);

  return (
    <View style={[styles.wrap, { backgroundColor: theme.background }]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        style={styles.scrollFlex}
        keyboardShouldPersistTaps="handled"
      >
        {recipe.imageUri ? (
          <Image
            source={{ uri: recipe.imageUri }}
            style={styles.coverImage}
            resizeMode="cover"
            accessibilityLabel="Receptfoto"
          />
        ) : null}
        <Text style={styles.title}>{recipe.title}</Text>
        {recipe.description ? <Text style={styles.desc}>{recipe.description}</Text> : null}

        <PortionScaler baseServings={recipe.baseServings} value={servings} onChange={setServings} />

        <Text style={[styles.section, { color: theme.accent }]}>Ingrediënten</Text>
        {recipe.ingredientGroups.map((g) => (
          <View key={g.id} style={styles.block}>
            {g.title ? <Text style={styles.subHeader}>{g.title}</Text> : null}
            {g.ingredients.map((i) => {
              const line = formatScaledIngredientLine(i.amount, i.unit, i.name, factor);
              return (
                <Pressable
                  key={i.id}
                  style={[styles.row, ingChecked.has(i.id) && styles.rowDone]}
                  onPress={() => toggleIng(i.id)}
                >
                  <Text style={styles.check}>{ingChecked.has(i.id) ? '☑' : '☐'}</Text>
                  <Text style={[styles.rowText, ingChecked.has(i.id) && styles.rowTextDone]}>
                    {line}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ))}

        <Text style={[styles.section, { color: theme.accent }]}>Stappen</Text>
        {recipe.stepSections.map((s) => (
          <View key={s.id} style={styles.block}>
            {s.title ? <Text style={styles.subHeader}>{s.title}</Text> : null}
            {s.steps.map((st) => {
              const timer = timersByStepIdRef.current[st.id];
              const done = stepChecked.has(st.id);
              const num = stepNumberById.get(st.id) ?? 0;
              const remainingSec =
                timer?.status === 'running'
                  ? remainingSecondsFromEnd(timer.endMs)
                  : timer?.status === 'paused'
                    ? timer.remainingSec
                    : null;
              return (
                <View key={st.id} style={styles.stepWrap}>
                  <Pressable
                    style={[styles.row, done && styles.rowDone]}
                    onPress={() => toggleStep(st.id)}
                  >
                    <Text
                      style={[
                        styles.stepNum,
                        !done && { color: theme.accent },
                        done && styles.stepNumDone,
                      ]}
                    >
                      {num}.
                    </Text>
                    <Text style={[styles.rowText, done && styles.stepRowTextDone]}>
                      {st.description}
                    </Text>
                  </Pressable>
                  {st.timerSeconds != null && st.timerSeconds > 0 ? (
                    <View style={[styles.timerRow, done && styles.timerRowDone]}>
                      {timer != null && remainingSec != null ? (
                        <View style={styles.timerActiveRow}>
                          <Text style={[styles.timerText, done && styles.timerTextDone]}>
                            {formatRemain(remainingSec)}
                          </Text>
                          <View style={styles.timerIcons}>
                            <Pressable
                              onPress={() => togglePauseTimer(st.id)}
                              hitSlop={6}
                              accessibilityRole="button"
                              accessibilityLabel={
                                timer.status === 'running' ? 'Pauzeer timer' : 'Hervat timer'
                              }
                              style={styles.timerIconBtn}
                            >
                              <MaterialIcons
                                name={timer.status === 'running' ? 'pause' : 'play-arrow'}
                                size={30}
                                color={done ? '#999' : theme.accent}
                              />
                            </Pressable>
                            <Pressable
                              onPress={() => resetTimer(st.id)}
                              hitSlop={6}
                              accessibilityRole="button"
                              accessibilityLabel="Reset timer"
                              style={styles.timerIconBtn}
                            >
                              <MaterialIcons
                                name="refresh"
                                size={28}
                                color={done ? '#999' : '#666'}
                              />
                            </Pressable>
                          </View>
                        </View>
                      ) : (
                        <Pressable
                          style={styles.timerBtn}
                          onPress={() => startTimer(st.id, st.timerSeconds!)}
                        >
                          <Text style={styles.timerBtnText}>
                            Start timer ({formatStepTimerNl(st.timerSeconds)})
                          </Text>
                        </Pressable>
                      )}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        ))}
      </ScrollView>
      <CookingChatPanel
        recipe={recipe}
        recipeId={recipeId}
        servings={servings}
        onRecipeUpdated={reload}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  scrollFlex: { flex: 1 },
  scroll: { padding: 16, paddingBottom: 88 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  muted: { color: '#666' },
  coverImage: {
    width: '100%',
    height: 180,
    borderRadius: 12,
    backgroundColor: '#e8e4dc',
    marginBottom: 12,
  },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 8, color: '#1a1a1a' },
  desc: { fontSize: 15, color: '#555', marginBottom: 16, lineHeight: 22 },
  section: { fontSize: 18, fontWeight: '700', marginTop: 20, marginBottom: 8 },
  block: { marginBottom: 4 },
  subHeader: { fontSize: 14, fontWeight: '600', color: '#666', marginTop: 8, marginBottom: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2ddd5',
    marginBottom: 8,
    gap: 10,
  },
  rowDone: { backgroundColor: '#f0f0ee', borderColor: '#dddcd8' },
  check: { fontSize: 20, lineHeight: 24 },
  stepNum: {
    minWidth: 30,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
    textAlign: 'right',
  },
  stepNumDone: { color: '#999' },
  rowText: { flex: 1, fontSize: 16, lineHeight: 22, color: '#1a1a1a' },
  rowTextDone: { textDecorationLine: 'line-through', color: '#888' },
  stepRowTextDone: { color: '#999' },
  stepWrap: { marginBottom: 4 },
  /** Lijn uit met tekst na stapnummer (padding 8 + nummer 30 + gap 10). */
  timerRow: { marginLeft: 48, marginBottom: 12 },
  timerRowDone: { opacity: 0.75 },
  timerActiveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    alignSelf: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2ddd5',
  },
  timerIcons: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  timerIconBtn: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: '#f7f6f3',
    borderWidth: 1,
    borderColor: '#e2ddd5',
  },
  timerText: { fontSize: 26, fontWeight: '800', color: '#1a1a1a', fontVariant: ['tabular-nums'] },
  timerTextDone: { color: '#999' },
  timerBtn: {
    alignSelf: 'flex-start',
    backgroundColor: '#2a6cb6',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  timerBtnText: { color: '#fff', fontWeight: '600' },
});
