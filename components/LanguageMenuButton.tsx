import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

import { LANGUAGES, type LanguageId } from '../lib/i18n';
import { useAppTheme } from './ThemeContext';
import { useI18n } from './I18nContext';

/** Taal-knop rechtsboven in Instellingen; opent een menu met beide talen. */
export function LanguageMenuButton() {
  const theme = useAppTheme();
  const { t, languageId, setLanguage } = useI18n();
  const [open, setOpen] = useState(false);

  const pick = (id: LanguageId) => {
    setOpen(false);
    if (id !== languageId) {
      void setLanguage(id);
    }
  };

  return (
    <>
      <Pressable hitSlop={10} style={styles.button} onPress={() => setOpen(true)}>
        <MaterialIcons name="language" size={24} color={theme.accent} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t('settings.languageMenuTitle')}</Text>
            {LANGUAGES.map((language) => (
              <Pressable
                key={language.id}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                onPress={() => pick(language.id)}
              >
                <Text style={[styles.rowLabel, language.id === languageId && styles.rowActive]}>
                  {language.label}
                </Text>
                {language.id === languageId ? (
                  <MaterialIcons name="check" size={20} color={theme.accent} />
                ) : null}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  button: { paddingHorizontal: 4 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(20, 15, 10, 0.35)',
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
    padding: 16,
  },
  card: {
    width: 220,
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 6,
    elevation: 6,
  },
  cardTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  rowPressed: { backgroundColor: '#faf3ef' },
  rowLabel: { fontSize: 15, fontWeight: '600', color: '#1a1a1a' },
  rowActive: { color: '#c45c3e' },
});
