import { useFocusEffect } from '@react-navigation/native';
import { useHeaderHeight } from '@react-navigation/elements';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AiPromptsCatalogModal } from '../../components/AiPromptsCatalogModal';
import { useConfirmDialog } from '../../components/ConfirmDialog';
import { useAppTheme } from '../../components/ThemeContext';
import {
  aiCookProfileLinesToText,
  aiCookProfileTextToLines,
  clearAiCookProfile,
  getAiCookProfile,
  hydrateAiCookProfileFromDb,
  setAiCookProfile,
  type AiCookProfile,
} from '../../lib/aiCookProfile';
import { ensureDatabaseAsync } from '../../lib/db';

export default function AiCookProfileSettingsScreen() {
  const theme = useAppTheme();
  const { confirm, ConfirmDialog } = useConfirmDialog();
  const web = Platform.OS === 'web';
  const headerHeight = useHeaderHeight();

  const [loaded, setLoaded] = useState(false);
  const [mustNotText, setMustNotText] = useState('');
  const [avoidText, setAvoidText] = useState('');
  const [preferText, setPreferText] = useState('');
  const [freeText, setFreeText] = useState('');
  const [weekPlanningTimeNotes, setWeekPlanningTimeNotes] = useState('');
  const [defaultServings, setDefaultServings] = useState(2);
  const [nearbyShops, setNearbyShops] = useState<string[]>([]);

  const [applyTips, setApplyTips] = useState(true);
  const [applyAdjust, setApplyAdjust] = useState(true);
  const [applySuggest, setApplySuggest] = useState(true);
  const [promptsModalOpen, setPromptsModalOpen] = useState(false);

  const nextProfileRef = useRef<AiCookProfile | null>(null);
  const loadedRef = useRef(false);

  const reload = useCallback(() => {
    void (async () => {
      await ensureDatabaseAsync();
      await hydrateAiCookProfileFromDb();
      const p = getAiCookProfile();
      setMustNotText(aiCookProfileLinesToText(p.mustNot));
      setAvoidText(aiCookProfileLinesToText(p.avoid));
      setPreferText(aiCookProfileLinesToText(p.prefer));
      setFreeText(p.freeText ?? '');
      setNearbyShops(p.nearbyShops ?? []);
      setWeekPlanningTimeNotes(p.weekPlanningTimeNotes ?? '');
      setDefaultServings(p.defaultServings ?? 2);
      setApplyTips(p.appliesTo.tipsChat);
      setApplyAdjust(p.appliesTo.adjustRecipe);
      setApplySuggest(p.appliesTo.recipeSuggestions);
      setLoaded(true);
    })();
  }, []);

  const nextProfile: AiCookProfile = useMemo(
    () => ({
      mustNot: aiCookProfileTextToLines(mustNotText),
      avoid: aiCookProfileTextToLines(avoidText),
      prefer: aiCookProfileTextToLines(preferText),
      freeText: freeText.trim(),
      nearbyShops,
      defaultServings: Math.max(1, Math.min(99, Math.round(defaultServings))),
      weekPlanningTimeNotes: weekPlanningTimeNotes.trim(),
      appliesTo: { tipsChat: applyTips, adjustRecipe: applyAdjust, recipeSuggestions: applySuggest },
    }),
    [applyAdjust, applySuggest, applyTips, avoidText, defaultServings, freeText, mustNotText, nearbyShops, preferText, weekPlanningTimeNotes]
  );

  nextProfileRef.current = nextProfile;

  useEffect(() => {
    loadedRef.current = loaded;
  }, [loaded]);

  useFocusEffect(
    useCallback(() => {
      reload();
      return () => {
        if (web || !loadedRef.current) return;
        const p = nextProfileRef.current;
        if (p) void setAiCookProfile(p);
      };
    }, [reload, web])
  );

  const toggleShop = useCallback((label: string) => {
    setNearbyShops((prev) => {
      const s = new Set(prev.map((x) => x.trim()).filter(Boolean));
      if (s.has(label)) s.delete(label);
      else s.add(label);
      return Array.from(s);
    });
  }, []);

  const shopOptions = useMemo(
    () => ['Supermarkt', 'Toko', 'Turkse supermarkt', 'Poolse supermarkt'],
    []
  );
  const selectedShops = useMemo(() => new Set(nearbyShops), [nearbyShops]);

  const onSave = useCallback(() => {
    if (web) return;
    void (async () => {
      await setAiCookProfile(nextProfile);
      Alert.alert('Opgeslagen', 'Je kookprofiel wordt voortaan meegenomen bij AI-antwoorden.');
    })();
  }, [nextProfile, web]);

  const onClear = useCallback(() => {
    if (web) return;
    void (async () => {
      const ok = await confirm({
        title: 'Kookprofiel wissen?',
        message: 'Dit verwijdert alle voorkeuren (allergieën, dislikes en instructies) voor AI.',
        confirmText: 'Wissen',
        cancelText: 'Annuleren',
        destructive: true,
      });
      if (!ok) return;
      await clearAiCookProfile();
      reload();
    })();
  }, [confirm, reload, web]);

  return (
    <KeyboardAvoidingView
      style={[styles.scroll, { backgroundColor: theme.background }]}
      behavior={web ? undefined : Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={web ? 0 : headerHeight}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <ConfirmDialog />
        <Text style={styles.lead}>
          Stel hier je vaste voorkeuren in. De app voegt dit automatisch toe aan AI-prompts (bijv. kooktips en recept
          aanpassen), zodat de antwoorden beter bij jou passen.
        </Text>
        {!web ? (
          <Text style={styles.autoSaveHint}>
            Wijzigingen worden automatisch opgeslagen wanneer je teruggaat naar de vorige pagina (los van de knop
            Opslaan).
          </Text>
        ) : null}

        {web ? (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>Op web worden instellingen alleen weergegeven. Gebruik iOS of Android om op te slaan.</Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.h2}>Standaard porties</Text>
          <Text style={styles.p}>Dit getal gebruikt de app als standaard bij AI weekmenu’s en suggesties.</Text>
          <View style={styles.stepperRow}>
            <Pressable
              style={[styles.stepBtn, defaultServings <= 1 && styles.stepBtnOff]}
              onPress={() => setDefaultServings((v) => Math.max(1, v - 1))}
              disabled={defaultServings <= 1}
              hitSlop={10}
            >
              <Text style={styles.stepBtnText}>−</Text>
            </Pressable>
            <Text style={styles.stepValue}>{defaultServings}</Text>
            <Pressable style={styles.stepBtn} onPress={() => setDefaultServings((v) => Math.min(99, v + 1))} hitSlop={10}>
              <Text style={styles.stepBtnText}>+</Text>
            </Pressable>
          </View>
        </View>

      <Text style={styles.section}>Waar toepassen?</Text>
      <View style={styles.switchRow}>
        <View style={styles.switchTextCol}>
          <Text style={styles.switchLabel}>Tips & chat tijdens het koken</Text>
          <Text style={styles.hint}>Bij vragen zoals vervangingen, timing, techniek en smaakbalans.</Text>
        </View>
        <Switch
          value={applyTips && !web}
          onValueChange={(v) => {
            if (!web) setApplyTips(v);
          }}
          disabled={web}
          trackColor={{ false: '#ddd', true: theme.accentBorderMuted }}
          thumbColor={applyTips && !web ? theme.accent : '#f4f3f4'}
        />
      </View>

      <View style={styles.switchRow}>
        <View style={styles.switchTextCol}>
          <Text style={styles.switchLabel}>Recept aanpassen</Text>
          <Text style={styles.hint}>Als je een recept laat wijzigen op basis van je notitie of chat.</Text>
        </View>
        <Switch
          value={applyAdjust && !web}
          onValueChange={(v) => {
            if (!web) setApplyAdjust(v);
          }}
          disabled={web}
          trackColor={{ false: '#ddd', true: theme.accentBorderMuted }}
          thumbColor={applyAdjust && !web ? theme.accent : '#f4f3f4'}
        />
      </View>

      <View style={styles.switchRow}>
        <View style={styles.switchTextCol}>
          <Text style={styles.switchLabel}>Receptsuggesties (later)</Text>
          <Text style={styles.hint}>Voor weekplanning of “wat zal ik eten?”-suggesties.</Text>
        </View>
        <Switch
          value={applySuggest && !web}
          onValueChange={(v) => {
            if (!web) setApplySuggest(v);
          }}
          disabled={web}
          trackColor={{ false: '#ddd', true: theme.accentBorderMuted }}
          thumbColor={applySuggest && !web ? theme.accent : '#f4f3f4'}
        />
      </View>

      <Text style={styles.section}>Weekplanning — tijdschema (optioneel)</Text>
      <Text style={styles.hint}>
        Vrij tekstveld. Bijvoorbeeld welke dagen je meestal weinig of juist veel tijd hebt om te koken. Dit wordt alleen
        gebruikt bij weekplanning/suggesties.
      </Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        placeholder={'Bijv.\n- ma/di: weinig tijd (max 20–30 min)\n- do/za: uitgebreid koken kan'}
        placeholderTextColor="#999"
        value={weekPlanningTimeNotes}
        onChangeText={setWeekPlanningTimeNotes}
        editable={!web}
        multiline
      />

      <Text style={styles.section}>Winkels in de buurt (optioneel)</Text>
      <Text style={styles.hint}>
        Kies waar je meestal boodschappen doet. De AI kan dan rekening houden met wat daar verkrijgbaar is.
      </Text>
      <View style={styles.chipWrap}>
        {shopOptions.map((opt) => {
          const on = selectedShops.has(opt);
          return (
            <Pressable
              key={opt}
              style={[
                styles.chip,
                on ? { backgroundColor: theme.accentSoft, borderColor: theme.accent } : null,
              ]}
              onPress={() => {
                if (!web) toggleShop(opt);
              }}
              disabled={web}
            >
              <Text
                style={[
                  styles.chipText,
                  on ? { color: theme.accentSoftText } : null,
                ]}
              >
                {opt}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.section}>Harde grenzen</Text>
      <Text style={styles.hint}>
        Zet hier allergieën of ingrediënten die je nooit wil. Eén per regel. Voorbeeld: “paprika (allergie)”.
      </Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        placeholder={'Bijv.\n- paprika (allergie)\n- schaaldieren'}
        placeholderTextColor="#999"
        value={mustNotText}
        onChangeText={setMustNotText}
        editable={!web}
        multiline
      />

      <Text style={styles.section}>Liever vermijden</Text>
      <Text style={styles.hint}>Dislikes die meestal vermeden moeten worden. Eén per regel. Voorbeeld: “zuurkool”.</Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        placeholder={'Bijv.\n- zuurkool\n- lever'}
        placeholderTextColor="#999"
        value={avoidText}
        onChangeText={setAvoidText}
        editable={!web}
        multiline
      />

      <Text style={styles.section}>Voorkeuren</Text>
      <Text style={styles.hint}>
        Zachte voorkeuren (“meestal vega”, “pittig”, “liefst 30 min”). Eén per regel. Voorbeeld: “meestal vegetarisch,
        ongeveer 1× per week vlees”.
      </Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        placeholder={'Bijv.\n- meestal vegetarisch (1× per week vlees)\n- hou van pittig'}
        placeholderTextColor="#999"
        value={preferText}
        onChangeText={setPreferText}
        editable={!web}
        multiline
      />

      <Text style={styles.section}>Extra instructie (optioneel)</Text>
      <Text style={styles.hint}>Vrij tekstveld voor nuance. Houd het kort; het wordt bij elke AI-aanroep meegestuurd.</Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        placeholder="Bijv. graag simpele stappen en zo min mogelijk pannen."
        placeholderTextColor="#999"
        value={freeText}
        onChangeText={setFreeText}
        editable={!web}
        multiline
      />

      <View style={styles.row}>
        <Pressable
          style={[styles.btnPrimary, { backgroundColor: theme.accent }, (web || !loaded) && styles.btnDisabled]}
          onPress={onSave}
          disabled={web || !loaded}
        >
          <Text style={styles.btnPrimaryText}>Opslaan</Text>
        </Pressable>
        <Pressable style={[styles.btnOutline, web && styles.btnDisabled]} onPress={onClear} disabled={web || !loaded}>
          <Text style={[styles.btnOutlineText, { color: '#b00020' }]}>Wissen</Text>
        </Pressable>
      </View>

      <Pressable
        style={[styles.btnPrompts, { borderColor: theme.accent }]}
        onPress={() => setPromptsModalOpen(true)}
        accessibilityRole="button"
      >
        <Text style={[styles.btnPromptsText, { color: theme.accent }]}>Bekijk AI-prompts</Text>
      </Pressable>

      <AiPromptsCatalogModal visible={promptsModalOpen} onClose={() => setPromptsModalOpen(false)} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  lead: { fontSize: 14, color: '#555', lineHeight: 21, marginBottom: 10 },
  autoSaveHint: { fontSize: 13, color: '#666', lineHeight: 19, marginBottom: 16, fontStyle: 'italic' },
  notice: {
    backgroundColor: '#fff8e6',
    borderWidth: 1,
    borderColor: '#f0d78c',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  noticeText: { fontSize: 14, color: '#6b5a1e', lineHeight: 20 },
  section: { fontSize: 17, fontWeight: '700', color: '#1a1a1a', marginTop: 20, marginBottom: 8 },
  hint: { fontSize: 13, color: '#666', lineHeight: 19, marginBottom: 10 },
  input: {
    borderWidth: 1,
    borderColor: '#e2ddd5',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    backgroundColor: '#fff',
    color: '#1a1a1a',
    marginBottom: 12,
  },
  multiline: { minHeight: 90, textAlignVertical: 'top' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginTop: 6 },
  btnPrimary: { paddingHorizontal: 18, paddingVertical: 11, borderRadius: 8 },
  btnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  btnOutline: {
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#f5c6cb',
    backgroundColor: '#fff',
  },
  btnOutlineText: { fontWeight: '700', fontSize: 15 },
  btnDisabled: { opacity: 0.45 },
  card: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2ddd5',
    borderRadius: 12,
    padding: 12,
    marginTop: 6,
  },
  h2: { fontSize: 16, fontWeight: '800', color: '#1a1a1a', marginBottom: 6 },
  p: { fontSize: 13, color: '#666', lineHeight: 18, marginBottom: 10 },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#f7f6f3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnOff: { opacity: 0.4 },
  stepBtnText: { fontSize: 20, fontWeight: '900', color: '#1a1a1a' },
  stepValue: { fontSize: 18, fontWeight: '900', color: '#1a1a1a', minWidth: 30, textAlign: 'center' },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 8,
  },
  switchTextCol: { flex: 1, minWidth: 0 },
  switchLabel: { fontSize: 15, fontWeight: '600', color: '#1a1a1a', marginBottom: 4 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#e2ddd5',
    backgroundColor: '#fff',
  },
  chipText: { fontSize: 13, fontWeight: '700', color: '#444' },
  btnPrompts: {
    marginTop: 20,
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: '#fff',
  },
  btnPromptsText: { fontWeight: '700', fontSize: 15 },
});

