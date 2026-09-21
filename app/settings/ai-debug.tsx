import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import { useAppTheme } from '../../components/ThemeContext';
import { listAiApiKeys } from '../../lib/aiKeyring';
import { getActiveAiKeyId, hydrateAiPrefsFromDb, setActiveAiKeyId } from '../../lib/aiPrefs';
import { getAiRequestLogEnabled, setAiRequestLogEnabled } from '../../lib/aiRequestLogPrefs';
import { ensureDatabaseAsync } from '../../lib/db';
import {
  clearAiRequestLogs,
  formatAiRequestLogEntry,
  listAiRequestLogs,
  type AiRequestLogEntry,
} from '../../lib/aiRequestLog';

export default function AiDebugLogScreen() {
  const theme = useAppTheme();
  const web = Platform.OS === 'web';
  const [logs, setLogs] = useState<AiRequestLogEntry[]>([]);
  const [requestLog, setRequestLogState] = useState(false);
  /** Logging is geïmplementeerd voor Anthropic en Mistral aanroepen. */
  const [activeKeyIsLoggedProvider, setActiveKeyIsLoggedProvider] = useState(false);

  const reload = useCallback(() => {
    void (async () => {
      await ensureDatabaseAsync();
      await hydrateAiPrefsFromDb();
      const list = await listAiApiKeys();
      let active = getActiveAiKeyId();
      if (!active && list.length > 0) {
        active = list[0].id;
        await setActiveAiKeyId(active);
      }
      const entry = active ? list.find((k) => k.id === active) : null;
      setActiveKeyIsLoggedProvider(
        entry?.provider === 'anthropic' || entry?.provider === 'mistral'
      );
      try {
        setRequestLogState(await getAiRequestLogEnabled());
      } catch {
        /* */
      }
      setLogs(listAiRequestLogs());
    })();
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  const onToggleRequestLog = useCallback((on: boolean) => {
    void (async () => {
      try {
        await setAiRequestLogEnabled(on);
        setRequestLogState(on);
      } catch (e) {
        Alert.alert('Fout', e instanceof Error ? e.message : 'Opslaan mislukt.');
      }
    })();
  }, []);

  const onShare = useCallback(async () => {
    const body = logs.map((e) => formatAiRequestLogEntry(e)).join('\n\n---\n\n');
    if (!body.trim()) {
      Alert.alert('Leeg', 'Er zijn nog geen logregels.');
      return;
    }
    Alert.alert(
      'Log delen?',
      'Bevat modelnamen, groottes en eventuele foutteksten. Geen API-sleutels. Alleen delen als je dit bewust wilt.',
      [
        { text: 'Annuleren', style: 'cancel' },
        {
          text: 'Delen',
          onPress: () => {
            void (async () => {
              try {
                await Share.share({ message: body, title: 'Kookapp AI-debuglog' });
              } catch {
                Alert.alert('Delen mislukt', 'Kon de log niet delen.');
              }
            })();
          },
        },
      ]
    );
  }, [logs]);

  const onClear = useCallback(() => {
    Alert.alert('Log wissen?', 'Dit verwijdert alleen de lokale debuglog op dit apparaat.', [
      { text: 'Annuleren', style: 'cancel' },
      {
        text: 'Wissen',
        style: 'destructive',
        onPress: () => {
          clearAiRequestLogs();
          reload();
        },
      },
    ]);
  }, [reload]);

  return (
    <ScrollView
      style={[styles.scroll, { backgroundColor: theme.background }]}
      contentContainerStyle={styles.content}
    >
      <Text style={styles.lead}>
        Dit scherm toont de meest recente AI API-aanroepen (lokaal, in het geheugen). API-sleutels
        worden niet gelogd; base64-afbeeldingen worden alleen als lengte geteld. Alleen Anthropic en
        Mistral aanroepen worden gelogd.
      </Text>

      <View style={styles.switchRow}>
        <View style={styles.switchTextCol}>
          <Text style={styles.switchLabel}>AI-request logging</Text>
          <Text style={styles.hint}>
            Model, HTTP-status, geschatte payload-groottes en eventuele usage-tokens. Alleen bij
            Anthropic- en Mistral-aanroepen.
          </Text>
        </View>
        <Switch
          value={requestLog && !web && activeKeyIsLoggedProvider}
          onValueChange={(v) => {
            if (!web && activeKeyIsLoggedProvider) void onToggleRequestLog(v);
          }}
          disabled={web || !activeKeyIsLoggedProvider}
          trackColor={{ false: '#ddd', true: theme.accentBorderMuted }}
          thumbColor={requestLog && !web && activeKeyIsLoggedProvider ? theme.accent : '#f4f3f4'}
        />
      </View>
      {!web && !activeKeyIsLoggedProvider ? (
        <Text style={styles.notice}>
          Kies een actieve Anthropic of Mistral API-sleutel bij Instellingen → AI om logging te
          kunnen inschakelen.
        </Text>
      ) : null}

      <View style={styles.row}>
        <Pressable
          style={[styles.btn, { backgroundColor: theme.accent }]}
          onPress={() => void onShare()}
        >
          <Text style={styles.btnText}>Delen</Text>
        </Pressable>
        <Pressable style={[styles.btnOutline, { borderColor: theme.accent }]} onPress={onClear}>
          <Text style={[styles.btnOutlineText, { color: theme.accent }]}>Wissen</Text>
        </Pressable>
        <Pressable style={[styles.btnOutline, { borderColor: theme.accent }]} onPress={reload}>
          <Text style={[styles.btnOutlineText, { color: theme.accent }]}>Vernieuwen</Text>
        </Pressable>
      </View>

      {logs.length === 0 ? (
        <Text style={styles.muted}>
          Nog geen logregels. Voer een AI-actie uit of zet logging aan.
        </Text>
      ) : (
        logs.map((e) => (
          <View key={e.id} style={styles.card}>
            <Text selectable style={styles.mono}>
              {formatAiRequestLogEntry(e)}
            </Text>
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
  switchRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
  },
  switchTextCol: { flex: 1, minWidth: 0 },
  switchLabel: { fontSize: 15, fontWeight: '600', color: '#1a1a1a', marginBottom: 4 },
  hint: { fontSize: 13, color: '#666', lineHeight: 19, marginBottom: 0 },
  notice: {
    fontSize: 14,
    color: '#6b5a1e',
    lineHeight: 20,
    marginBottom: 14,
    padding: 12,
    backgroundColor: '#fff8e6',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#f0d78c',
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  btn: { paddingHorizontal: 16, paddingVertical: 11, borderRadius: 10 },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  btnOutline: {
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
    backgroundColor: '#fff',
  },
  btnOutlineText: { fontWeight: '800', fontSize: 15 },
  muted: { fontSize: 14, color: '#888' },
  card: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2ddd5',
    backgroundColor: '#fff',
    marginBottom: 12,
  },
  mono: { fontFamily: 'monospace', fontSize: 11, color: '#222', lineHeight: 16 },
});
