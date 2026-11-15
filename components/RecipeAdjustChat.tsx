import { Link } from 'expo-router';
import { type ComponentRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { callAiChat, hasActiveAiKey, type AiChatTurn } from '../lib/aiClient';
import { buildAdjustChatSystemPrompt, applyAdjustmentFromChat } from '../lib/recipeAdjust';
import { applyRecipeFromChat, buildCreateChatSystemPrompt } from '../lib/recipeCreate';
import { applyAiAdjustedRecipe } from '../lib/recipesRepo';
import {
  loadChatHistory,
  saveChatMessage,
  getOrCreateChatSession,
  chatMessageToAiTurn,
  type ChatSession,
} from '../lib/chatSessionRepo';
import type { FullRecipe, RecipeSavePayload } from '../lib/types';
import { ChatSheetKeyboardWrap } from './ChatSheetKeyboardWrap';
import { FormattedText } from './FormattedText';
import { useAppTheme } from './ThemeContext';

const QUICK_SUGGESTIONS = ['Maak het sneller klaar', 'Maak het gezonder', 'Meer smaak / kruiden'];
const CREATE_QUICK_SUGGESTIONS = [
  'Een snel vegetarisch gerecht voor doordeweeks',
  'Comfort food met pasta',
  'Iets met kip, citroen en knoflook',
];

type BaseProps = {
  visible: boolean;
  onClose: () => void;
};

/** Bestaand gedrag: chat over een opgeslagen recept; apply schrijft naar de DB. */
type AdjustModeProps = {
  mode: 'adjust';
  recipe: FullRecipe;
  recipeId: number;
  onApplied: () => void;
  /** Servings for this chat context, defaults to baseServings */
  servings?: number;
};

/**
 * Nieuw recept (of aanpassing van de huidige invoer) op de nieuw-recept pagina:
 * apply levert een payload aan het formulier in plaats van naar de DB.
 * Chat-historie wordt hier niet gepersisteerd (nog geen recipe_id).
 */
type CreateModeProps = {
  mode: 'create';
  /** Huidige formulierinhoud als basis; zonder baseDraft: recept vanaf nul. */
  baseDraft?: FullRecipe | null;
  /** Krijgt de AI-payload om in het formulier te laden. Retourneer false om de chat open te houden. */
  onApplyPayload: (payload: RecipeSavePayload) => Promise<boolean> | boolean;
};

type Props = BaseProps & (AdjustModeProps | CreateModeProps);

export function RecipeAdjustChat(props: Props) {
  const { visible, onClose, mode } = props;
  const recipe = mode === 'adjust' ? props.recipe : (props.baseDraft ?? null);
  const recipeId = mode === 'adjust' ? props.recipeId : null;
  const servings = mode === 'adjust' ? (props.servings ?? props.recipe.baseServings ?? 1) : 1;
  const onApplied = mode === 'adjust' ? props.onApplied : undefined;
  const onApplyPayload = mode === 'create' ? props.onApplyPayload : undefined;
  const theme = useAppTheme();
  const [turns, setTurns] = useState<AiChatTurn[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState(false);
  const [chatSession, setChatSession] = useState<ChatSession | null>(null);
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const sendInFlightRef = useRef(false);

  const systemPrompt = useMemo(
    () => (recipe ? buildAdjustChatSystemPrompt(recipe) : buildCreateChatSystemPrompt()),
    [recipe]
  );

  useEffect(() => {
    if (!visible) return;
    void hasActiveAiKey()
      .then(setHasKey)
      .catch(() => setHasKey(false));
  }, [visible]);

  /** Load chat history when panel becomes visible (alleen adjust-modus heeft een DB-sessie) */
  useEffect(() => {
    if (!visible || mode !== 'adjust' || recipeId == null) return;

    void (async () => {
      try {
        const history = await loadChatHistory(recipeId, servings);
        if (history) {
          setChatSession(history.session);
          setTurns(history.messages.map(chatMessageToAiTurn));
        } else {
          const session = await getOrCreateChatSession(recipeId, servings);
          setChatSession(session);
        }
      } catch (e) {
        console.error('Failed to load adjust chat history:', e);
      }
    })();
  }, [visible, mode, recipeId, servings]);

  // In create-modus blijft het gesprek in het geheugen bij heropenen; in adjust-modus reset per recept.
  const resetKey = mode === 'adjust' ? (recipe?.id ?? null) : null;
  useEffect(() => {
    setTurns([]);
    setError(null);
    setInput('');
    setChatSession(null);
  }, [resetKey]);

  const hasAssistantReply = turns.some((t) => t.role === 'assistant');
  const busy = loading || applying;

  const isCreate = mode === 'create';
  const sheetTitle = isCreate
    ? recipe
      ? 'Aanpassen met AI'
      : 'Recept maken met AI'
    : 'Recept aanpassen';
  const introText = isCreate
    ? recipe
      ? 'Beschrijf wat je wilt veranderen aan de huidige invoer. De assistent bespreekt de aanpassingen met je — daarna kun je ze in het formulier laden.'
      : 'Beschrijf welk recept je wilt, bijv. «een snelle pasta met citroen». De assistent bedenkt het recept met je — daarna kun je het in het formulier laden.'
    : `Beschrijf wat je wilt veranderen aan «${recipe?.title ?? ''}». De assistent bespreekt de aanpassingen met je — daarna kun je ze toepassen.`;
  const suggestions = isCreate ? CREATE_QUICK_SUGGESTIONS : QUICK_SUGGESTIONS;
  const applyLabel = isCreate ? 'Inladen in formulier' : 'Ja doen, voeg toe';
  const inputPlaceholder =
    isCreate && !recipe
      ? 'Bijv. een snel vegetarisch recept…'
      : 'Bijv. meer knoflook, kortere bereidingstijd…';

  const sendWithText = useCallback(
    async (userText: string) => {
      const trimmed = userText.trim();
      if (!trimmed || busy) return;
      if (sendInFlightRef.current) return;
      sendInFlightRef.current = true;

      const base =
        turns.length > 0 && turns[turns.length - 1].role === 'user' ? turns.slice(0, -1) : turns;

      const nextHistory: AiChatTurn[] = [...base, { role: 'user', text: trimmed }];
      setTurns(nextHistory);
      setInput('');
      setError(null);
      setLoading(true);

      // Save user message to DB if we have a session
      if (chatSession) {
        try {
          await saveChatMessage(chatSession.id, 'user', trimmed);
        } catch (e) {
          console.error('Failed to save user message:', e);
        }
      }

      try {
        const res = await callAiChat({
          system: systemPrompt,
          messages: nextHistory,
          maxTokens: 2048,
          task: 'adjust',
        });

        if (!res.ok) {
          setError(res.message);
          return;
        }
        const assistantTurn: AiChatTurn = { role: 'assistant', text: res.text.trim() };
        setTurns([...nextHistory, assistantTurn]);

        // Save assistant message to DB if we have a session
        if (chatSession) {
          try {
            await saveChatMessage(chatSession.id, 'assistant', res.text.trim());
          } catch (e) {
            console.error('Failed to save assistant message:', e);
          }
        }
      } finally {
        setLoading(false);
        sendInFlightRef.current = false;
      }
    },
    [busy, systemPrompt, turns, chatSession]
  );

  const onSend = useCallback(() => {
    void sendWithText(input);
  }, [input, sendWithText]);

  const onApply = useCallback(async () => {
    if (busy) return;
    setApplying(true);
    setError(null);

    try {
      if (mode === 'adjust') {
        if (!recipe || recipeId == null || !onApplied) return;
        const result = await applyAdjustmentFromChat(recipe, turns);
        if (!result.ok) {
          setError(result.message);
          return;
        }
        const summaryParts = turns.filter((t) => t.role === 'user').map((t) => t.text);
        const adjustmentNote = summaryParts.join(' — ');
        await applyAiAdjustedRecipe(recipeId, result.payload, adjustmentNote);
        setTurns([]);
        setInput('');
        onApplied();
        onClose();
        Alert.alert(
          'Opgeslagen',
          'Het recept is bijgewerkt. De vorige versie staat in de versiegeschiedenis.'
        );
      } else {
        if (!onApplyPayload) return;
        const result = recipe
          ? await applyAdjustmentFromChat(recipe, turns)
          : await applyRecipeFromChat(turns);
        if (!result.ok) {
          setError(result.message);
          return;
        }
        const applied = await onApplyPayload(result.payload);
        if (!applied) return; // chat blijft open, gebruiker kan het voorstel bijsturen
        setTurns([]);
        setInput('');
        onClose();
        Alert.alert(
          'Ingeladen in het formulier',
          'Controleer de velden en sla op om het recept aan te maken.'
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Toepassen mislukt.');
    } finally {
      setApplying(false);
    }
  }, [busy, mode, recipe, recipeId, turns, onApplied, onClose, onApplyPayload]);

  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150);
    return () => clearTimeout(t);
  }, [visible, turns, loading, error]);

  const handleClose = useCallback(() => {
    if (busy) return;
    Keyboard.dismiss();
    onClose();
  }, [busy, onClose]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <View style={styles.modalRoot}>
        <Pressable style={styles.modalBackdrop} onPress={handleClose} />
        <ChatSheetKeyboardWrap style={[styles.sheet, { backgroundColor: theme.background }]}>
          <View style={styles.sheetInner}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{sheetTitle}</Text>
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
              <Text style={styles.intro}>{introText}</Text>

              <View style={styles.quickRow}>
                {suggestions.map((q) => (
                  <Pressable
                    key={q}
                    style={[
                      styles.quickChip,
                      { backgroundColor: theme.accentSoft, borderColor: theme.accentBorderMuted },
                    ]}
                    onPress={() => void sendWithText(q)}
                    disabled={busy || !hasKey}
                  >
                    <Text
                      style={[styles.quickChipText, { color: theme.accentSoftText }]}
                      numberOfLines={2}
                    >
                      {q}
                    </Text>
                  </Pressable>
                ))}
              </View>

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

            <View style={styles.inputRowTop}>
              <TextInput
                style={styles.input}
                placeholder={inputPlaceholder}
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

            {hasAssistantReply && !busy ? (
              <View style={styles.applyRow}>
                <Pressable style={styles.applyBtn} onPress={() => void onApply()}>
                  <Text style={styles.applyBtnText}>{applyLabel}</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        </ChatSheetKeyboardWrap>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: { flex: 1, justifyContent: 'center' },
  modalBackdrop: {
    ...StyleSheet.absoluteFill,
    zIndex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  sheet: {
    zIndex: 2,
    flex: 1,
  },
  sheetInner: {
    flex: 1,
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
  chatScroll: { flex: 1 },
  chatContent: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12 },
  intro: { fontSize: 13, color: '#666', marginBottom: 16, lineHeight: 19 },
  bubble: {
    marginBottom: 10,
    padding: 10,
    borderRadius: 10,
    maxWidth: '100%',
  },
  bubbleUser: { backgroundColor: '#e8f0fc', alignSelf: 'flex-end' },
  bubbleAsst: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2ddd5',
    alignSelf: 'flex-start',
  },
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
    marginBottom: 16,
  },
  quickChip: {
    borderWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    maxWidth: '100%',
  },
  quickChipText: { fontSize: 12, fontWeight: '600' },
  inputRowTop: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e2ddd5',
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
