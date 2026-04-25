import { Link } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { callAiChat, hasActiveAiKey, type AiChatTurn } from '../lib/aiClient';
import { buildCookingSystemPrompt } from '../lib/cookingAssistant';
import { applyAdjustmentFromChat } from '../lib/recipeAdjust';
import { applyAiAdjustedRecipe } from '../lib/recipesRepo';
import type { FullRecipe } from '../lib/types';
import { FormattedText } from './FormattedText';
import { useAppTheme } from './ThemeContext';

const ADJUST_TAG = '<<AANPASSING>>';

function stripAdjustTag(text: string): { clean: string; isAdjustment: boolean } {
  const idx = text.indexOf(ADJUST_TAG);
  if (idx === -1) return { clean: text, isAdjustment: false };
  return { clean: text.slice(0, idx).trimEnd(), isAdjustment: true };
}

const QUICK_TIPS = [
  'Kan ik dit een dag van tevoren voorbereiden?',
  'Wat kan ik gebruiken als ik een ingrediënt mis?',
  'Hoe weet ik of het goed gaar is?',
];

type Props = {
  recipe: FullRecipe;
  recipeId: number;
  servings: number;
  onRecipeUpdated?: () => void;
};

export function CookingChatPanel({ recipe, recipeId, servings, onRecipeUpdated }: Props) {
  const theme = useAppTheme();
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<AiChatTurn[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState(false);
  const [adjustSuggested, setAdjustSuggested] = useState(false);
  const [applying, setApplying] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const systemPrompt = useMemo(
    () => buildCookingSystemPrompt(recipe, servings),
    [recipe, servings]
  );

  useEffect(() => {
    void hasActiveAiKey().then(setHasKey);
  }, [open]);

  /** Bij ander recept of andere porties: chat leegmaken (andere context). */
  useEffect(() => {
    setTurns([]);
    setError(null);
    setInput('');
  }, [recipe.id, servings]);

  const busy = loading || applying;

  const sendWithText = useCallback(
    async (userText: string) => {
      const trimmed = userText.trim();
      if (!trimmed || busy) return;

      const base =
        turns.length > 0 && turns[turns.length - 1].role === 'user'
          ? turns.slice(0, -1)
          : turns;

      const nextHistory: AiChatTurn[] = [...base, { role: 'user', text: trimmed }];
      setTurns(nextHistory);
      setInput('');
      setError(null);
      setAdjustSuggested(false);
      setLoading(true);

      const res = await callAiChat({
        system: systemPrompt,
        messages: nextHistory,
        maxTokens: 1536,
      });

      setLoading(false);
      if (!res.ok) {
        setError(res.message);
        return;
      }

      const { clean, isAdjustment } = stripAdjustTag(res.text.trim());
      setTurns([...nextHistory, { role: 'assistant', text: clean }]);
      setAdjustSuggested(isAdjustment);
    },
    [busy, systemPrompt, turns]
  );

  const onApplyAdjustment = useCallback(async () => {
    if (applying) return;
    setApplying(true);
    setError(null);

    const result = await applyAdjustmentFromChat(recipe, turns);

    if (!result.ok) {
      setApplying(false);
      setError(result.message);
      return;
    }

    try {
      const note = turns
        .filter((t) => t.role === 'user')
        .map((t) => t.text)
        .join(' — ');
      await applyAiAdjustedRecipe(recipeId, result.payload, note);
      setApplying(false);
      setAdjustSuggested(false);
      onRecipeUpdated?.();
      Alert.alert(
        'Recept aangepast',
        'De wijziging is opgeslagen. De vorige versie staat in de versiegeschiedenis.'
      );
    } catch (e) {
      setApplying(false);
      setError(e instanceof Error ? e.message : 'Opslaan mislukt.');
    }
  }, [applying, recipe, recipeId, turns, onRecipeUpdated]);

  const onSend = useCallback(() => {
    void sendWithText(input);
  }, [input, sendWithText]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150);
    return () => clearTimeout(t);
  }, [open, turns, loading, applying, error]);

  return (
    <>
      <Pressable
        style={[styles.fab, { backgroundColor: theme.accent }]}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
      >
        <Text style={styles.fabText}>Tips & vraag</Text>
      </Pressable>

      <Modal
        visible={open}
        animationType="slide"
        transparent
        onRequestClose={() => setOpen(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalRoot}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <Pressable style={styles.modalBackdrop} onPress={() => setOpen(false)} />
          <ScrollView
            style={[styles.sheet, { backgroundColor: theme.background }]}
            scrollEnabled={false}
            keyboardShouldPersistTaps="always"
            contentContainerStyle={styles.sheetInner}
          >
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Kookhulp</Text>
              <View style={styles.headerActions}>
                <Pressable
                  style={styles.micBtn}
                  disabled
                  accessibilityLabel="Stem invoer (later beschikbaar)"
                  accessibilityState={{ disabled: true }}
                >
                  <Text style={styles.micIcon}>🎤</Text>
                </Pressable>
                <Pressable onPress={() => setOpen(false)} hitSlop={12}>
                  <Text style={styles.close}>Sluiten</Text>
                </Pressable>
              </View>
            </View>
            <Text style={styles.micHint}>Stem: later (Whisper)</Text>

            {!hasKey ? (
              <View style={styles.warnBox}>
                <Text style={styles.warnText}>
                  Zet een API-sleutel in Instellingen om tips te kunnen vragen.
                </Text>
                <Link href="/settings" asChild>
                  <Pressable style={styles.linkBtn}>
                    <Text style={styles.linkBtnText}>Naar instellingen</Text>
                  </Pressable>
                </Link>
              </View>
            ) : null}

            <ScrollView
              ref={scrollRef}
              style={styles.chatScroll}
              contentContainerStyle={styles.chatContent}
              keyboardShouldPersistTaps="always"
            >
              <Text style={styles.intro}>
                Stel een korte vraag over dit recept (je kookt voor {servings} persoon
                {servings === 1 ? '' : 'en'}).
              </Text>
              {turns.map((m, i) => (
                <View
                  key={`${i}-${m.role}`}
                  style={[styles.bubble, m.role === 'user' ? styles.bubbleUser : styles.bubbleAsst]}
                >
                  <Text style={styles.bubbleRole}>{m.role === 'user' ? 'Jij' : 'Kok'}</Text>
                  <FormattedText text={m.text} style={styles.bubbleText} />
                </View>
              ))}
              {loading ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator color={theme.accent} />
                  <Text style={styles.loadingText}>Even geduld…</Text>
                </View>
              ) : null}
              {applying ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator color="#2a6cb6" />
                  <Text style={styles.loadingText}>Recept aanpassen…</Text>
                </View>
              ) : null}
              {error ? (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>{error}</Text>
                  <Text style={styles.errorHint}>Verstuur je vraag nogmaals of probeer het later.</Text>
                </View>
              ) : null}
            </ScrollView>

            {adjustSuggested && !busy ? (
              <View style={styles.adjustRow}>
                <Pressable style={styles.adjustBtn} onPress={() => void onApplyAdjustment()}>
                  <Text style={styles.adjustBtnText}>Recept aanpassen</Text>
                </Pressable>
              </View>
            ) : null}

            <View style={styles.quickRow}>
              {QUICK_TIPS.map((q) => (
                <Pressable
                  key={q}
                  style={[
                    styles.quickChip,
                    { backgroundColor: theme.accentSoft, borderColor: theme.accentBorderMuted },
                  ]}
                  onPress={() => void sendWithText(q)}
                  disabled={busy || !hasKey}
                >
                  <Text style={[styles.quickChipText, { color: theme.accentSoftText }]} numberOfLines={2}>
                    {q}
                  </Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                placeholder="Je vraag…"
                placeholderTextColor="#999"
                value={input}
                onChangeText={setInput}
                multiline
                maxLength={800}
                editable={hasKey && !busy}
              />
              <Pressable
                style={[
                  styles.sendBtn,
                  { backgroundColor: theme.accent },
                  (!input.trim() || busy || !hasKey) && styles.sendBtnOff,
                ]}
                onPress={onSend}
                disabled={!input.trim() || busy || !hasKey}
              >
                <Text style={styles.sendBtnText}>Verstuur</Text>
              </Pressable>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: 14,
    bottom: 20,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 999,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  fabText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  sheet: {
    zIndex: 2,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '78%',
    borderTopWidth: 1,
    borderColor: '#e2ddd5',
  },
  sheetInner: {
    paddingBottom: Platform.OS === 'ios' ? 28 : 16,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
  },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: '#1a1a1a' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  micBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#eee',
    justifyContent: 'center',
    alignItems: 'center',
    opacity: 0.45,
  },
  micIcon: { fontSize: 18 },
  micHint: { fontSize: 11, color: '#999', paddingHorizontal: 16, marginTop: -4, marginBottom: 6 },
  close: { fontSize: 16, color: '#2a6cb6', fontWeight: '600' },
  warnBox: {
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 12,
    backgroundColor: '#fff8e6',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#f0d78c',
  },
  warnText: { fontSize: 14, color: '#5c4a1a', marginBottom: 10 },
  linkBtn: { alignSelf: 'flex-start' },
  linkBtnText: { color: '#2a6cb6', fontWeight: '700', fontSize: 15 },
  chatScroll: { maxHeight: 320 },
  chatContent: { paddingHorizontal: 16, paddingBottom: 12 },
  intro: { fontSize: 13, color: '#666', marginBottom: 12, lineHeight: 19 },
  bubble: {
    marginBottom: 10,
    padding: 10,
    borderRadius: 10,
    maxWidth: '100%',
  },
  bubbleUser: { backgroundColor: '#e8f0fc', alignSelf: 'flex-end' },
  bubbleAsst: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2ddd5', alignSelf: 'flex-start' },
  bubbleRole: { fontSize: 11, fontWeight: '700', color: '#888', marginBottom: 4 },
  bubbleText: { fontSize: 15, color: '#1a1a1a', lineHeight: 22 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 8 },
  loadingText: { fontSize: 14, color: '#666' },
  errorBox: {
    backgroundColor: '#fdecea',
    borderWidth: 1,
    borderColor: '#f5c6cb',
    borderRadius: 10,
    padding: 12,
    marginTop: 8,
  },
  errorText: { color: '#b00020', fontSize: 14, fontWeight: '600', lineHeight: 20 },
  errorHint: { color: '#7a3b3b', fontSize: 13, marginTop: 4, lineHeight: 18 },
  adjustRow: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  adjustBtn: {
    backgroundColor: '#2a6cb6',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  adjustBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  quickRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  quickChip: {
    borderWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    maxWidth: '100%',
  },
  quickChipText: { fontSize: 12, fontWeight: '600' },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: '#e2ddd5',
    paddingTop: 10,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 100,
    borderWidth: 1,
    borderColor: '#e2ddd5',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    backgroundColor: '#fff',
  },
  sendBtn: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  sendBtnOff: { opacity: 0.45 },
  sendBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
