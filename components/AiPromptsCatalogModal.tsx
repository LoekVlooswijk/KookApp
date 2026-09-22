import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from './ThemeContext';
import { getAiPromptCatalog } from '../lib/aiPromptsCatalog';

type Props = {
  visible: boolean;
  onClose: () => void;
};

export function AiPromptsCatalogModal({ visible, onClose }: Props) {
  const theme = useAppTheme();
  const catalog = useMemo(() => getAiPromptCatalog(), []);
  const [activeId, setActiveId] = useState(catalog[0]?.id ?? '');

  useEffect(() => {
    if (visible && catalog[0]?.id) setActiveId(catalog[0].id);
  }, [visible, catalog]);

  const active = useMemo(
    () => catalog.find((e) => e.id === activeId) ?? catalog[0] ?? null,
    [activeId, catalog]
  );

  if (!active) return null;

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Sluiten" />
        <View style={[styles.card, { backgroundColor: theme.background }]}>
          <Text style={styles.title}>AI-prompts in deze app</Text>
          <Text style={styles.subtitle}>
            Per functie zie je het systeembericht (of samengestelde prompt) zoals de app die nu
            opbouwt. Onder elke tab staat welke context en welk deel van je kookprofiel (indien van
            toepassing) worden meegestuurd.
          </Text>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.tabScroll}
            contentContainerStyle={styles.tabRow}
          >
            {catalog.map((e) => {
              const on = e.id === active.id;
              return (
                <Pressable
                  key={e.id}
                  onPress={() => setActiveId(e.id)}
                  style={[
                    styles.tab,
                    on
                      ? { backgroundColor: theme.accent, borderColor: theme.accent }
                      : styles.tabOff,
                  ]}
                >
                  <Text
                    style={[
                      styles.tabText,
                      on ? { color: '#fff', fontWeight: '700' } : { color: '#333' },
                    ]}
                    numberOfLines={2}
                  >
                    {e.title}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.section}>Context en meegestuurde informatie</Text>
            {active.contextLines.map((line, i) => (
              <Text key={i} style={styles.bullet}>
                {'\u2022 '}
                {line}
              </Text>
            ))}

            {active.userRoleNl ? (
              <>
                <Text style={[styles.section, styles.sectionSpaced]}>Gebruikersinvoer (user)</Text>
                <Text style={styles.p}>{active.userRoleNl}</Text>
              </>
            ) : null}

            {active.userExample ? (
              <>
                <Text style={[styles.section, styles.sectionSpaced]}>
                  Voorbeeld of fragment user-bericht
                </Text>
                <View style={styles.codeBox}>
                  <Text selectable style={styles.code}>
                    {active.userExample}
                  </Text>
                </View>
              </>
            ) : null}

            <Text style={[styles.section, styles.sectionSpaced]}>Systeembericht (system)</Text>
            <View style={styles.codeBox}>
              <Text selectable style={styles.code}>
                {active.systemPrompt}
              </Text>
            </View>
          </ScrollView>

          <Pressable style={[styles.closeBtn, { backgroundColor: theme.accent }]} onPress={onClose}>
            <Text style={styles.closeBtnText}>Sluiten</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'center', padding: 16 },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.45)' },
  card: {
    borderRadius: 14,
    padding: 16,
    maxHeight: '88%',
    borderWidth: 1,
    borderColor: '#e2ddd5',
  },
  title: { fontSize: 18, fontWeight: '800', color: '#1a1a1a', marginBottom: 8 },
  subtitle: { fontSize: 13, color: '#555', lineHeight: 19, marginBottom: 12 },
  tabScroll: { flexGrow: 0, marginBottom: 10 },
  tabRow: { flexDirection: 'row', flexWrap: 'nowrap', gap: 8, paddingVertical: 4 },
  tab: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#ddd',
    maxWidth: 200,
  },
  tabOff: { backgroundColor: '#f5f4f1' },
  tabText: { fontSize: 12, lineHeight: 16 },
  body: { flexGrow: 1 },
  bodyContent: { paddingBottom: 12 },
  section: { fontSize: 15, fontWeight: '700', color: '#1a1a1a', marginBottom: 8 },
  sectionSpaced: { marginTop: 14 },
  bullet: { fontSize: 13, color: '#444', lineHeight: 20, marginBottom: 6, paddingRight: 4 },
  p: { fontSize: 13, color: '#444', lineHeight: 20 },
  codeBox: {
    backgroundColor: '#faf8f5',
    borderWidth: 1,
    borderColor: '#e8e4dc',
    borderRadius: 10,
    padding: 10,
  },
  code: { fontSize: 11, lineHeight: 16, color: '#222', fontFamily: 'monospace' },
  closeBtn: { marginTop: 12, paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  closeBtnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
});
