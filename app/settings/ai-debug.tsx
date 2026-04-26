import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '../../components/ThemeContext';
import { clearAiRequestLogs, formatAiRequestLogEntry, listAiRequestLogs, type AiRequestLogEntry } from '../../lib/aiRequestLog';

export default function AiDebugLogScreen() {
  const theme = useAppTheme();
  const [logs, setLogs] = useState<AiRequestLogEntry[]>([]);

  const reload = useCallback(() => {
    setLogs(listAiRequestLogs());
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  const onShare = useCallback(async () => {
    const body = logs.map((e) => formatAiRequestLogEntry(e)).join('\n\n---\n\n');
    if (!body.trim()) {
      Alert.alert('Leeg', 'Er zijn nog geen logregels.');
      return;
    }
    try {
      await Share.share({ message: body, title: 'Kookapp AI-debuglog' });
    } catch {
      Alert.alert('Delen mislukt', 'Kon de log niet delen.');
    }
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
    <ScrollView style={[styles.scroll, { backgroundColor: theme.background }]} contentContainerStyle={styles.content}>
      <Text style={styles.lead}>
        Dit scherm toont de meest recente Anthropic API-aanroepen (lokaal, in het geheugen). Zet logging aan bij
        Instellingen → AI. API-sleutels worden niet gelogd; base64-afbeeldingen worden alleen als lengte geteld.
      </Text>

      <View style={styles.row}>
        <Pressable style={[styles.btn, { backgroundColor: theme.accent }]} onPress={() => void onShare()}>
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
        <Text style={styles.muted}>Nog geen logregels. Voer een AI-actie uit of zet logging aan.</Text>
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
