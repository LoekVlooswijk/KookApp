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
import { buildAdjustChatSystemPrompt, applyAdjustmentFromChat } from '../lib/recipeAdjust';
import { applyAiAdjustedRecipe } from '../lib/recipesRepo';
import type { FullRecipe } from '../lib/types';
import { FormattedText } from './FormattedText';
import { useAppTheme } from './ThemeContext';

const QUICK_SUGGESTIONS = [
  'Maak het sneller klaar',
  'Maak het gezonder',
  'Meer smaak / kruiden',
];

type Props = {
  recipe: FullRecipe;
  recipeId: number;
  visible: boolean;
  onClose: () => void;
  onApplied: () => void;
};

export function RecipeAdjustChat({ recipe, recipeId, visible, onClose, onApplied }: Props) {
  const theme = useAppTheme();
  const [turns, setTurns] = useState<AiChatTurn[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const systemPrompt = useMemo(
    () => buildAdjustChatSystemPrompt(recipe),
    [recipe]
  );

  useEffect(() => {
    if (visible) void hasActiveAiKey().then(setHasKey);
  }, [visible]);

  useEffect(() => {
    setTurns([]);
    setError(null);
    setInput('');
  }, [recipe.id]);

  const hasAssistantReply = turns.some((t) => t.role === 'assistant');
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
      setLoading(true);

      const res = await callAiChat({
        system: systemPrompt,
        messages: nextHistory,
        maxTokens: 2048,
      });

      setLoading(false);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setTurns([...nextHistory, { role: 'assistant', text: res.text.trim() }]);
    },
    [busy, systemPrompt, turns]
  );

  const onSend = useCallback(() => {
    void sendWithText(input);
  }, [input, sendWithText]);

  const onApply = useCallback(async () => {
    if (!recipe || applying) return;
    setApplying(true);
    setError(null);

    const result = await applyAdjustmentFromChat(recipe, turns);

    if (!result.ok) {
      setApplying(false);
      setError(result.message);
      return;
    }

    try {
      const summaryParts = turns
        .filter((t) => t.role === 'user')
        .map((t) => t.text);
      const adjustmentNote = summaryParts.join(' — ');

      await applyAiAdjustedRecipe(recipeId, result.payload, adjustmentNote);
      setApplying(false);
      setTurns([]);
      setInput('');
      onApplied();
      onClose();
      Alert.alert(
        'Opgeslagen',
        'Het recept is bijgewerkt. De vorige versie staat in de versiegeschiedenis.'
      );
    } catch (e) {
      setApplying(false);
      setError(e instanceof Error ? e.message : 'Opslaan mislukt.');
    }
  }, [recipe, recipeId, turns, applying, onApplied, onClose]);

  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150);
    return () => clearTimeout(t);
  }, [visible, turns, loading, error]);

  const handleClose = useCallback(() => {
    if (busy) return;
    onClose();
  }, [busy, onClose]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <KeyboardAvoidingView
        style={styles.modalRoot}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.modalBackdrop} onPress={handleClose} />
        <ScrollView
          style={[styles.sheet, { backgroundColor: theme.background }]}
          scrollEnabled={false}
          keyboardShouldPersistTaps="always"
          contentContainerStyle={styles.sheetInner}
        >
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Recept aanpassen</Text>
            <Pressable onPress={handleClose} hitSlop={12} disabled={busy}>
              <Text style={[styles.close, busy && { opacity: 0.4 }]}>Sluiten</Text>
            </Pressable>
          </View>

          {!hasKey ? (
            <View style={styles.warnBox}>
              <Text style={styles.warnText}>
                Zet een API-sleutel in Instellingen om AI-aanpassingen te gebruiken.
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
              Beschrijf wat je wilt veranderen aan «{recipe.title}». De assistent bespreekt de aanpassingen met je —
              daarna kun je ze toepassen.
            </Text>
            {turns.map((m, i) => (
              <View
                key={`${i}-${m.role}`}
                style={[styles.bubble, m.role === 'user' ? styles.bubbleUser : styles.bubbleAsst]}
              >
                <Text style={styles.bubbleRole}>{m.role === 'user' ? 'Jij' : 'Chef'}</Text>
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
                <Text style={styles.loadingText}>Aanpassingen doorvoeren…</Text>
              </View>
            ) : null}
            {error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}
          </ScrollView>

          {hasAssistantReply && !busy ? (
            <View style={styles.applyRow}>
              <Pressable style={styles.applyBtn} onPress={() => void onApply()}>
                <Text style={styles.applyBtnText}>Ja doen, voeg toe</Text>
              </Pressable>
            </View>
          ) : null}

          <View style={styles.quickRow}>
            {QUICK_SUGGESTIONS.map((q) => (
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
              placeholder="Bijv. meer knoflook, kortere bereidingstijd…"
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
  );
}

const styles = StyleSheet.create({
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
    maxHeight: '85%',
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
  chatScroll: { maxHeight: 340 },
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
  applyRow: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#e2ddd5',
  },
  applyBtn: {
    backgroundColor: '#2a6cb6',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  applyBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
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
