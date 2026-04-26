import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '../../components/ThemeContext';
import { disposeImportSession, getImportSession } from '../../lib/importDraft';
import { createRecipe } from '../../lib/recipesRepo';

export default function RecipeImportPreviewScreen() {
  const theme = useAppTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ importSid?: string | string[]; mode?: string | string[] }>();
  const rawSid = Array.isArray(params.importSid) ? params.importSid[0] : params.importSid;
  const sid = rawSid != null && rawSid !== '' ? rawSid : undefined;
  const rawMode = Array.isArray(params.mode) ? params.mode[0] : params.mode;
  const mode = (rawMode ?? '').trim();
  const allowSave = mode === 'single';

  const payload = useMemo(() => (sid ? getImportSession(sid) : null), [sid]);

  if (!payload) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <Text style={styles.title}>Geen preview beschikbaar</Text>
        <Text style={styles.muted}>Deze importsessie is verlopen. Ga terug en probeer opnieuw.</Text>
        <Pressable
          style={[styles.btn, { backgroundColor: theme.accent }]}
          onPress={() => router.back()}
        >
          <Text style={styles.btnText}>Terug</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView style={[styles.scroll, { backgroundColor: theme.background }]} contentContainerStyle={styles.content}>
      <Text style={styles.previewTitle}>Controle</Text>
      <Text style={styles.head}>{payload.title}</Text>

      {payload.description ? <Text style={styles.desc}>{payload.description}</Text> : null}

      <View style={styles.metaRow}>
        {payload.totalTimeMin != null ? <Text style={styles.meta}>Tijd: {payload.totalTimeMin} min</Text> : null}
        {payload.baseServings != null ? <Text style={styles.meta}>Porties: {payload.baseServings}</Text> : null}
        {payload.category ? <Text style={styles.meta}>Categorie: {payload.category}</Text> : null}
      </View>

      <Text style={styles.section}>Ingrediënten</Text>
      {payload.ingredientGroups.map((g, gi) => (
        <View key={`${gi}-${g.title ?? ''}`} style={styles.block}>
          {g.title ? <Text style={styles.groupTitle}>{g.title}</Text> : null}
          {g.ingredients.map((ing, ii) => (
            <Text key={`${gi}-${ii}`} style={styles.line}>
              {ing.amount != null ? `${ing.amount} ` : ''}
              {ing.unit ? `${ing.unit} ` : ''}
              {ing.name}
            </Text>
          ))}
        </View>
      ))}

      <Text style={styles.section}>Bereiding</Text>
      {payload.stepSections.map((s, si) => (
        <View key={`${si}-${s.title ?? ''}`} style={styles.block}>
          {s.title ? <Text style={styles.groupTitle}>{s.title}</Text> : null}
          {s.steps.map((st, i) => (
            <Text key={`${si}-${i}`} style={styles.line}>
              {i + 1}. {st.description}
            </Text>
          ))}
        </View>
      ))}

      <View style={styles.row}>
        {allowSave ? (
          <Pressable
            style={[styles.btn, { backgroundColor: theme.accent }]}
            onPress={() => {
              if (!payload) return;
              void (async () => {
                try {
                  await createRecipe(payload);
                  if (sid) disposeImportSession(sid);
                  // Return to import screen and clear the URL-preview state there.
                  router.replace({ pathname: '/recipe/import', params: { saved: '1' } });
                } catch (e) {
                  Alert.alert('Fout', e instanceof Error ? e.message : 'Opslaan mislukt.');
                }
              })();
            }}
          >
            <Text style={styles.btnText}>Opslaan</Text>
          </Pressable>
        ) : null}
        <Pressable
          style={[styles.btn, { backgroundColor: theme.accentSoft, borderColor: theme.accent }]}
          onPress={() => {
            if (sid) disposeImportSession(sid);
            router.back();
          }}
        >
          <Text style={[styles.btnText, { color: theme.accentSoftText }]}>Sluiten</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, padding: 16, justifyContent: 'center' },
  previewTitle: { fontSize: 12, fontWeight: '800', color: '#888', textTransform: 'uppercase', marginBottom: 8 },
  head: { fontSize: 22, fontWeight: '800', color: '#1a1a1a', marginBottom: 8 },
  title: { fontSize: 18, fontWeight: '800', color: '#1a1a1a', marginBottom: 8 },
  muted: { fontSize: 14, color: '#777', lineHeight: 20, marginBottom: 16 },
  desc: { fontSize: 14, color: '#555', lineHeight: 21, marginBottom: 10 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 10 },
  meta: { fontSize: 13, color: '#666', fontWeight: '600' },
  section: { fontSize: 16, fontWeight: '800', color: '#1a1a1a', marginTop: 18, marginBottom: 8 },
  block: { marginBottom: 10 },
  groupTitle: { fontSize: 13, fontWeight: '800', color: '#444', marginBottom: 6 },
  line: { fontSize: 14, color: '#333', lineHeight: 20, marginBottom: 4 },
  row: { marginTop: 18, flexDirection: 'row', gap: 10 },
  btn: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'transparent',
    alignSelf: 'flex-start',
  },
  btnText: { fontWeight: '800', fontSize: 15, color: '#fff' },
});

