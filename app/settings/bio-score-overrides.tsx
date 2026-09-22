import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useConfirmDialog } from '../../components/ConfirmDialog';
import { useAppTheme } from '../../components/ThemeContext';
import type { BioScoreOverride } from '../../lib/bioScoreOverridesPrefs';
import {
  getBioScoreOverridesList,
  hydrateBioScoreOverridesPrefsFromDb,
  removeBioScoreOverride,
  upsertBioScoreOverride,
} from '../../lib/bioScoreOverridesPrefs';
import { ensureDatabaseAsync } from '../../lib/db';

const LOCALITY_OPTIONS: { id: BioScoreOverride['l']; label: string }[] = [
  { id: 'G', label: 'NL/BE/DE' },
  { id: 'O', label: 'Europa' },
  { id: 'R', label: 'Wereld' },
];

const PESTICIDE_OPTIONS: { id: BioScoreOverride['p']; label: string }[] = [
  { id: 'L', label: 'Laag' },
  { id: 'M', label: 'Middel' },
  { id: 'H', label: 'Hoog' },
];

export default function BioScoreOverridesSettingsScreen() {
  const theme = useAppTheme();
  const { confirm, ConfirmDialog } = useConfirmDialog();
  const web = Platform.OS === 'web';

  const [overrides, setOverrides] = useState<BioScoreOverride[]>([]);
  const [nameInput, setNameInput] = useState('');
  const [locality, setLocality] = useState<BioScoreOverride['l']>('G');
  const [pesticide, setPesticide] = useState<BioScoreOverride['p']>('L');

  const reload = useCallback(() => {
    void (async () => {
      await ensureDatabaseAsync();
      await hydrateBioScoreOverridesPrefsFromDb();
      setOverrides([...getBioScoreOverridesList()]);
    })();
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  const onAdd = useCallback(() => {
    if (web) return;
    const n = nameInput.trim();
    if (!n) {
      Alert.alert('Naam ontbreekt', 'Vul een productnaam in.');
      return;
    }
    void (async () => {
      await upsertBioScoreOverride({ n, l: locality, p: pesticide });
      setNameInput('');
      reload();
    })();
  }, [locality, nameInput, pesticide, reload, web]);

  const onRemove = useCallback(
    (name: string) => {
      if (web) return;
      void (async () => {
        const ok = await confirm({
          title: 'Productscore verwijderen?',
          message: `"${name}" gebruikt weer de AI-score bij herberekenen.`,
          confirmText: 'Verwijderen',
          cancelText: 'Annuleren',
          destructive: true,
        });
        if (!ok) return;
        await removeBioScoreOverride(name);
        reload();
      })();
    },
    [confirm, reload, web]
  );

  const chipOn = { backgroundColor: theme.accentSoft, borderColor: theme.accent };
  const chipTextOn = { color: theme.accentSoftText };

  return (
    <ScrollView
      style={[styles.scroll, { backgroundColor: theme.background }]}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <ConfirmDialog />

      <Text style={styles.lead}>
        Vaste scores gelden bij elke herberekening. Herkomst: G = NL/BE/DE, O = rest Europa, R =
        wereld. Pesticide: L/M/H.
      </Text>

      {web ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>
            Op web worden instellingen alleen weergegeven. Gebruik iOS of Android om op te slaan.
          </Text>
        </View>
      ) : null}

      <Text style={styles.label}>Productnaam</Text>
      <TextInput
        style={[styles.input, web && styles.inputDisabled]}
        value={nameInput}
        onChangeText={setNameInput}
        placeholder="Bijv. zoete aardappel"
        placeholderTextColor="#999"
        editable={!web}
      />

      <Text style={styles.subLabel}>Herkomst</Text>
      <View style={styles.chipRow}>
        {LOCALITY_OPTIONS.map((opt) => {
          const on = locality === opt.id;
          return (
            <Pressable
              key={opt.id}
              style={[styles.chip, on && chipOn]}
              onPress={() => setLocality(opt.id)}
              disabled={web}
            >
              <Text style={[styles.chipText, on && chipTextOn]}>
                {opt.id} · {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.subLabel}>Pesticide</Text>
      <View style={styles.chipRow}>
        {PESTICIDE_OPTIONS.map((opt) => {
          const on = pesticide === opt.id;
          return (
            <Pressable
              key={opt.id}
              style={[styles.chip, on && chipOn]}
              onPress={() => setPesticide(opt.id)}
              disabled={web}
            >
              <Text style={[styles.chipText, on && chipTextOn]}>
                {opt.id} · {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Pressable
        style={[styles.btnPrimary, { backgroundColor: theme.accent }, web && styles.btnDisabled]}
        onPress={onAdd}
        disabled={web}
      >
        <Text style={styles.btnPrimaryText}>Toevoegen of bijwerken</Text>
      </Pressable>

      <Text style={styles.section}>Opgeslagen productscores</Text>
      {overrides.length === 0 ? (
        <Text style={styles.empty}>Nog geen vaste scores.</Text>
      ) : (
        overrides.map((ov) => (
          <View key={ov.n} style={[styles.overrideRow, { borderColor: theme.accentBorderMuted }]}>
            <View style={styles.overrideMain}>
              <Text style={styles.overrideName}>{ov.n}</Text>
              <Text style={styles.overrideMeta}>
                herkomst {ov.l} · pesticide {ov.p}
              </Text>
            </View>
            <Pressable
              style={styles.removeBtn}
              onPress={() => onRemove(ov.n)}
              disabled={web}
              accessibilityRole="button"
              accessibilityLabel={`${ov.n} verwijderen`}
            >
              <Text style={styles.removeBtnText}>Verwijder</Text>
            </Pressable>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  lead: { fontSize: 14, color: '#555', lineHeight: 21, marginBottom: 16 },
  notice: {
    backgroundColor: '#fff8e6',
    borderWidth: 1,
    borderColor: '#f0d78c',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  noticeText: { fontSize: 14, color: '#6b5a1e', lineHeight: 20 },
  label: { fontSize: 15, fontWeight: '700', color: '#1a1a1a', marginBottom: 6 },
  subLabel: { fontSize: 14, fontWeight: '700', color: '#444', marginTop: 8, marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: '#e2ddd5',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    backgroundColor: '#fff',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  inputDisabled: { opacity: 0.45 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  chip: {
    borderWidth: 1,
    borderColor: '#e2ddd5',
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#fff',
  },
  chipText: { fontSize: 13, fontWeight: '700', color: '#444' },
  btnPrimary: {
    alignSelf: 'flex-start',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
    marginTop: 8,
    marginBottom: 20,
  },
  btnPrimaryText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  btnDisabled: { opacity: 0.45 },
  section: { fontSize: 17, fontWeight: '700', color: '#1a1a1a', marginBottom: 10 },
  empty: { fontSize: 14, color: '#888' },
  overrideRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    backgroundColor: '#fff',
    marginBottom: 10,
  },
  overrideMain: { flex: 1, minWidth: 0 },
  overrideName: { fontSize: 15, fontWeight: '700', color: '#1a1a1a' },
  overrideMeta: { fontSize: 13, color: '#666', marginTop: 4 },
  removeBtn: { paddingVertical: 6, paddingHorizontal: 8 },
  removeBtnText: { fontSize: 13, fontWeight: '700', color: '#b00020' },
});
