import { useFocusEffect } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation/elements';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
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
import { ensureDatabaseAsync } from '../../lib/db';
import {
  getShoppingOrganicAlwaysList,
  hydrateShoppingOrganicPrefsFromDb,
  organicListToText,
  organicTextToList,
  setShoppingOrganicAlwaysList,
} from '../../lib/shoppingOrganicPrefs';
import {
  getShoppingStaplesExcludeList,
  hydrateShoppingStaplesPrefsFromDb,
  setShoppingStaplesExcludeList,
  staplesListToText,
  staplesTextToList,
} from '../../lib/shoppingStaplesPrefs';

export default function ShoppingSettingsScreen() {
  const theme = useAppTheme();
  const { confirm, ConfirmDialog } = useConfirmDialog();
  const web = Platform.OS === 'web';
  const headerHeight = useHeaderHeight();

  const [text, setText] = useState('');
  const [organicText, setOrganicText] = useState('');
  const [loaded, setLoaded] = useState(false);
  const loadedRef = useRef(false);
  const nextTextRef = useRef('');
  const nextOrganicTextRef = useRef('');

  const reload = useCallback(() => {
    void (async () => {
      await ensureDatabaseAsync();
      await hydrateShoppingStaplesPrefsFromDb();
      await hydrateShoppingOrganicPrefsFromDb();
      setText(staplesListToText(getShoppingStaplesExcludeList()));
      setOrganicText(organicListToText(getShoppingOrganicAlwaysList()));
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    loadedRef.current = loaded;
  }, [loaded]);

  nextTextRef.current = text;
  nextOrganicTextRef.current = organicText;

  useFocusEffect(
    useCallback(() => {
      reload();
      return () => {
        if (web || !loadedRef.current) return;
        void (async () => {
          const list = staplesTextToList(nextTextRef.current);
          await setShoppingStaplesExcludeList(list);

          const organicList = organicTextToList(nextOrganicTextRef.current);
          await setShoppingOrganicAlwaysList(organicList);
        })();
      };
    }, [reload])
  );

  const onReset = useCallback(() => {
    if (web) return;
    void (async () => {
      const ok = await confirm({
        title: 'Resetten?',
        message: 'Dit zet de lijst terug naar een paar standaard pantry-items.',
        confirmText: 'Reset',
        cancelText: 'Annuleren',
        destructive: true,
      });
      if (!ok) return;
      await setShoppingStaplesExcludeList(['zout', 'peper', 'olie', 'water']);
      reload();
    })();
  }, [confirm, reload, web]);

  const onClearOrganic = useCallback(() => {
    if (web) return;
    void (async () => {
      const ok = await confirm({
        title: 'Biologisch-lijst leegmaken?',
        message: 'Dit wist alle regels in “Altijd biologisch”.',
        confirmText: 'Leegmaken',
        cancelText: 'Annuleren',
        destructive: true,
      });
      if (!ok) return;
      await setShoppingOrganicAlwaysList([]);
      reload();
    })();
  }, [confirm, reload, web]);

  return (
    <KeyboardAvoidingView
      style={[styles.scroll, { backgroundColor: theme.background }]}
      behavior={web ? undefined : Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={web ? 0 : headerHeight}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ConfirmDialog />
        <Text style={styles.lead}>
          Items in deze lijst worden <Text style={styles.bold}>niet</Text> automatisch toegevoegd
          aan je boodschappenlijst als ze in een gepland recept staan (handig voor zout, olie,
          water, enz.). Eén per regel.
        </Text>
        {!web ? (
          <Text style={styles.autoSaveHint}>
            Wijzigingen worden automatisch opgeslagen wanneer je teruggaat naar de vorige pagina.
          </Text>
        ) : null}

        {web ? (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>
              Op web worden instellingen alleen weergegeven. Gebruik iOS of Android om op te slaan.
            </Text>
          </View>
        ) : null}

        <Text style={styles.section}>Altijd op voorraad (uitsluiten)</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={text}
          onChangeText={setText}
          placeholder={'Bijv.\n- zout\n- peper\n- olijfolie\n- water'}
          placeholderTextColor="#999"
          multiline
          editable={!web}
        />

        <View style={styles.row}>
          <Pressable
            style={[styles.btnOutline, web && styles.btnDisabled]}
            onPress={onReset}
            disabled={web}
          >
            <Text style={[styles.btnOutlineText, { color: '#b00020' }]}>Reset</Text>
          </Pressable>
        </View>

        <Text style={[styles.section, { marginTop: 18 }]}>Altijd biologisch</Text>
        <Text style={styles.lead}>
          Items in deze lijst krijgen een <Text style={styles.bold}>groen blaadje</Text> op je
          boodschappenlijst (ook als ze via de weekplanner komen). Eén per regel.
        </Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={organicText}
          onChangeText={setOrganicText}
          placeholder={'Bijv.\n- paprika\n- aardbeien\n- druiven'}
          placeholderTextColor="#999"
          multiline
          editable={!web}
        />
        <View style={styles.row}>
          <Pressable
            style={[styles.btnOutline, web && styles.btnDisabled]}
            onPress={onClearOrganic}
            disabled={web}
          >
            <Text style={[styles.btnOutlineText, { color: '#b00020' }]}>Leegmaken</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  lead: { fontSize: 14, color: '#555', lineHeight: 21, marginBottom: 16 },
  autoSaveHint: {
    fontSize: 13,
    color: '#666',
    lineHeight: 19,
    marginBottom: 16,
    fontStyle: 'italic',
  },
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
  section: { fontSize: 17, fontWeight: '700', color: '#1a1a1a', marginTop: 6, marginBottom: 8 },
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
  multiline: { minHeight: 140, textAlignVertical: 'top' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginTop: 6 },
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
});
