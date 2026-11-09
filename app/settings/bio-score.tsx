import { useFocusEffect, useRouter } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation/elements';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { MaterialIcons } from '@expo/vector-icons';

import { useConfirmDialog } from '../../components/ConfirmDialog';
import { useAppTheme } from '../../components/ThemeContext';
import { computeMissingBioScores } from '../../lib/bioScoreBulk';
import {
  hydrateBioScoreEnabledFromDb,
  isBioScoreEnabled,
  setBioScoreEnabled,
} from '../../lib/bioScoreEnabledPrefs';
import {
  bioScoreExcludeListToText,
  bioScoreExcludeTextToList,
  getBioScoreExcludeList,
  hydrateBioScoreExcludePrefsFromDb,
  setBioScoreExcludeList,
} from '../../lib/bioScoreExcludePrefs';
import {
  getBioScoreThresholds,
  hydrateBioScoreThresholdsFromDb,
  normalizeBioScoreThresholds,
  resetBioScoreThresholdsToDefaults,
  setBioScoreThresholds,
} from '../../lib/bioScoreThresholdsPrefs';
import { ensureDatabaseAsync } from '../../lib/db';

export default function BioScoreSettingsScreen() {
  const theme = useAppTheme();
  const router = useRouter();
  const { confirm, ConfirmDialog } = useConfirmDialog();
  const web = Platform.OS === 'web';
  const headerHeight = useHeaderHeight();

  const [orangeText, setOrangeText] = useState('3');
  const [redText, setRedText] = useState('4');
  const [excludeText, setExcludeText] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const loadedRef = useRef(false);
  const nextExcludeTextRef = useRef('');

  const reload = useCallback(() => {
    void (async () => {
      await ensureDatabaseAsync();
      await hydrateBioScoreThresholdsFromDb();
      await hydrateBioScoreExcludePrefsFromDb();
      await hydrateBioScoreEnabledFromDb();
      setEnabled(isBioScoreEnabled());
      const t = getBioScoreThresholds();
      setOrangeText(String(t.orangeMin));
      setRedText(String(t.redMin));
      setExcludeText(bioScoreExcludeListToText(getBioScoreExcludeList()));
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    loadedRef.current = loaded;
  }, [loaded]);

  useEffect(() => {
    nextExcludeTextRef.current = excludeText;
  }, [excludeText]);

  useFocusEffect(
    useCallback(() => {
      reload();
      return () => {
        if (web || !loadedRef.current) return;
        void (async () => {
          await setBioScoreExcludeList(bioScoreExcludeTextToList(nextExcludeTextRef.current));
        })();
      };
    }, [reload, web])
  );

  const parsePositiveInt = (s: string): number | null => {
    const t = s.trim();
    if (!t) return null;
    const n = Number.parseInt(t, 10);
    if (!Number.isFinite(n)) return null;
    return n;
  };

  const onToggleEnabled = useCallback((next: boolean) => {
    setEnabled(next);
    void (async () => {
      await ensureDatabaseAsync();
      await setBioScoreEnabled(next);
    })();
  }, []);

  const onSaveThresholds = useCallback(() => {
    if (web) return;
    const oRaw = parsePositiveInt(orangeText);
    const rRaw = parsePositiveInt(redText);
    if (oRaw == null || rRaw == null) {
      Alert.alert(
        'Ongeldige invoer',
        'Vul twee hele getallen in (minimaal 1 voor oranje, 2 voor rood).'
      );
      return;
    }
    if (rRaw <= oRaw) {
      Alert.alert(
        'Ongeldige combinatie',
        'De rode drempel moet hoger zijn dan de oranje drempel. Pas de waarden aan.'
      );
      return;
    }
    const norm = normalizeBioScoreThresholds({ orangeMin: oRaw, redMin: rRaw });
    void (async () => {
      await setBioScoreThresholds(norm);
      setOrangeText(String(norm.orangeMin));
      setRedText(String(norm.redMin));
      Alert.alert(
        'Opgeslagen',
        'Nieuwe bio-score drempels worden gebruikt bij de volgende berekening.'
      );
    })();
  }, [orangeText, redText, web]);

  const onResetDefaults = useCallback(() => {
    if (web) return;
    void (async () => {
      const ok = await confirm({
        title: 'Standaard drempels?',
        message: 'Oranje vanaf 3 punten, rood vanaf 4 punten.',
        confirmText: 'Herstellen',
        cancelText: 'Annuleren',
      });
      if (!ok) return;
      await resetBioScoreThresholdsToDefaults();
      reload();
    })();
  }, [confirm, reload, web]);

  const onClearExclude = useCallback(() => {
    if (web) return;
    void (async () => {
      const ok = await confirm({
        title: 'Uitsluitlijst leegmaken?',
        message: 'Alle regels worden verwijderd.',
        confirmText: 'Leegmaken',
        cancelText: 'Annuleren',
        destructive: true,
      });
      if (!ok) return;
      await setBioScoreExcludeList([]);
      reload();
    })();
  }, [confirm, reload, web]);

  const onComputeMissing = useCallback(() => {
    if (web) return;
    void (async () => {
      const ok = await confirm({
        title: 'Bio scores berekenen?',
        message:
          'Dit berekent voor recepten zonder bio score een nieuwe score. Dit kan even duren.',
        confirmText: 'Berekenen',
        cancelText: 'Annuleren',
      });
      if (!ok) return;
      setBusy(true);
      try {
        const res = await computeMissingBioScores();
        Alert.alert(
          'Klaar',
          `${res.updated} recept${res.updated === 1 ? '' : 'en'} bijgewerkt. ${res.failed} mislukt.`
        );
      } catch (e) {
        Alert.alert('Fout', e instanceof Error ? e.message : 'Bio scores berekenen mislukt.');
      } finally {
        setBusy(false);
      }
    })();
  }, [confirm, web]);

  const chipOutline = { borderColor: theme.accentBorderMuted };

  return (
    <KeyboardAvoidingView
      style={[styles.scroll, { backgroundColor: theme.background }]}
      behavior={web ? undefined : Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={web ? 0 : headerHeight}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ConfirmDialog />

        <View style={styles.toggleRow}>
          <View style={styles.toggleRowMain}>
            <Text style={styles.toggleTitle}>Bio-score aan</Text>
            <Text style={styles.toggleSubtitle}>
              Toont groene/rode blaadjes en bio-score knoppen in de app. Bestaande scores blijven
              bewaard als je dit uitzet.
            </Text>
          </View>
          <Switch
            value={enabled}
            onValueChange={onToggleEnabled}
            disabled={web || !loaded || !enabled}
            accessibilityLabel="Bio-score aan"
          />
        </View>

        <Text style={styles.lead}>
          Per recept wordt een totaalscore opgebouwd uit geassayeerd groente en fruit:{' '}
          <Text style={styles.bold}>oranje herkomst (rest van Europa)</Text> of{' '}
          <Text style={styles.bold}>middel pesticide</Text> telt 1 punt;{' '}
          <Text style={styles.bold}>wereldherkomst</Text> of{' '}
          <Text style={styles.bold}>hoog pesticide</Text> telt 2 punten (per ingredient, herkomst en
          pesticide worden bij elkaar opgeteld).
        </Text>

        {web ? (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>
              Op web worden instellingen alleen weergegeven. Gebruik iOS of Android om op te slaan.
            </Text>
          </View>
        ) : null}

        <View style={!enabled && styles.disabledSection} pointerEvents={enabled ? 'auto' : 'none'}>
          <Text style={styles.section}>Drempels</Text>
          <Text style={styles.label}>Oranje vanaf totaalscore (inclusief)</Text>
          <TextInput
            style={[styles.input, web && styles.inputDisabled]}
            value={orangeText}
            onChangeText={setOrangeText}
            keyboardType="number-pad"
            editable={!web && loaded && enabled}
            placeholder="3"
            placeholderTextColor="#999"
          />

          <Text style={styles.label}>Rood vanaf totaalscore (inclusief)</Text>
          <TextInput
            style={[styles.input, web && styles.inputDisabled]}
            value={redText}
            onChangeText={setRedText}
            keyboardType="number-pad"
            editable={!web && loaded && enabled}
            placeholder="4"
            placeholderTextColor="#999"
          />

          <View style={styles.row}>
            <Pressable
              style={[
                styles.btnPrimary,
                { backgroundColor: theme.accent },
                web && styles.btnDisabled,
              ]}
              onPress={onSaveThresholds}
              disabled={web || !loaded || !enabled}
            >
              <Text style={styles.btnPrimaryText}>Drempels opslaan</Text>
            </Pressable>
            <Pressable
              style={[styles.btnOutline, chipOutline, web && styles.btnDisabled]}
              onPress={onResetDefaults}
              disabled={web || !loaded || !enabled}
            >
              <Text style={[styles.btnOutlineText, { color: theme.accent }]}>Standaard</Text>
            </Pressable>
          </View>

          <Text style={styles.section}>Niet meenemen in berekening</Text>
          <Text style={styles.lead}>
            Ingrediënten in deze lijst worden overgeslagen bij bio-score (bijv. citroensap). Eén per
            regel. Wijzigingen worden opgeslagen wanneer je teruggaat.
          </Text>
          <TextInput
            style={[styles.input, styles.multiline, web && styles.inputDisabled]}
            value={excludeText}
            onChangeText={setExcludeText}
            placeholder={'Bijv.\n- citroensap\n- limoen sap'}
            placeholderTextColor="#999"
            multiline
            editable={!web && loaded && enabled}
          />
          <View style={styles.row}>
            <Pressable
              style={[styles.btnOutline, chipOutline, web && styles.btnDisabled]}
              onPress={onClearExclude}
              disabled={web || !loaded || !enabled}
            >
              <Text style={[styles.btnOutlineText, { color: '#b00020' }]}>Leegmaken</Text>
            </Pressable>
          </View>

          <Text style={styles.section}>Vaste productscores</Text>
          <Text style={styles.lead}>
            Stel per product een vaste herkomst- en pesticidescore in (bijv. zoete aardappel uit NL
            → groen / laag).
          </Text>
          <Pressable
            style={[styles.navRow, chipOutline]}
            onPress={() => router.push('/settings/bio-score-overrides' as never)}
          >
            <MaterialIcons name="tune" size={22} color={theme.accent} />
            <View style={styles.navRowMain}>
              <Text style={styles.navRowTitle}>Productscores beheren</Text>
              <Text style={styles.navRowSubtitle}>Eigen scores voor specifieke producten</Text>
            </View>
            <Text style={[styles.navRowHint, { color: theme.accent }]}>›</Text>
          </Pressable>

          <Text style={styles.section}>Bulkactie</Text>
          <Pressable
            style={[styles.btnOutline, chipOutline, (web || busy) && styles.btnDisabled]}
            onPress={onComputeMissing}
            disabled={web || busy || !loaded}
          >
            <Text style={[styles.btnOutlineText, { color: theme.accent }]}>
              Bio scores berekenen
            </Text>
          </Pressable>
          {busy ? (
            <View style={styles.busyRow}>
              <ActivityIndicator size="small" color={theme.accent} />
              <Text style={styles.busyHint}>Even geduld…</Text>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: '#e2ddd5',
    borderRadius: 12,
    backgroundColor: '#fff',
    padding: 14,
    marginBottom: 14,
  },
  toggleRowMain: { flex: 1, minWidth: 0 },
  toggleTitle: { fontSize: 16, fontWeight: '800', color: '#1a1a1a' },
  toggleSubtitle: { fontSize: 13, color: '#8a8a8a', lineHeight: 18, marginTop: 2 },
  disabledSection: { opacity: 0.45 },
  lead: { fontSize: 14, color: '#555', lineHeight: 21, marginBottom: 14 },
  bold: { fontWeight: '800', color: '#1a1a1a' },
  notice: {
    backgroundColor: '#fff8e6',
    borderWidth: 1,
    borderColor: '#f0d78c',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  noticeText: { fontSize: 14, color: '#6b5a1e', lineHeight: 20 },
  section: { fontSize: 17, fontWeight: '700', color: '#1a1a1a', marginTop: 22, marginBottom: 8 },
  label: { fontSize: 15, fontWeight: '700', color: '#1a1a1a', marginBottom: 6 },
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
  multiline: { minHeight: 120, textAlignVertical: 'top' },
  inputDisabled: { opacity: 0.45 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginTop: 4 },
  btnPrimary: {
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 10,
  },
  btnPrimaryText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  btnOutline: {
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
    backgroundColor: '#fff',
  },
  btnOutlineText: { fontWeight: '700', fontSize: 15 },
  btnDisabled: { opacity: 0.45 },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderRadius: 12,
    backgroundColor: '#fff',
    marginBottom: 8,
  },
  navRowMain: { flex: 1, minWidth: 0, gap: 2 },
  navRowTitle: { fontSize: 15, fontWeight: '700', color: '#1a1a1a' },
  navRowSubtitle: { fontSize: 13, color: '#8a8a8a', lineHeight: 18 },
  navRowHint: { fontSize: 18, fontWeight: '900' },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  busyHint: { fontSize: 14, color: '#666' },
});
