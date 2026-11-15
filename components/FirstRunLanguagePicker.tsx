import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

import { LANGUAGES } from '../lib/i18n';
import { useI18n } from './I18nContext';

/**
 * Eerste-keuze taal-overlay (alleen zolang er nog geen taal gekozen is).
 * Per definitie tweetalig: de gebruiker heeft nog geen voorkeur, dus de
 * opties tonen hun eigen naam + een hint in de andere taal.
 */
export function FirstRunLanguagePicker() {
  const { setLanguage } = useI18n();

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <View style={styles.card}>
        <MaterialIcons name="language" size={36} color="#c45c3e" />
        <Text style={styles.title}>Kies je taal</Text>
        <Text style={styles.titleEn}>Choose your language</Text>
        <View style={styles.options}>
          {LANGUAGES.map((language) => (
            <Pressable
              key={language.id}
              style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
              onPress={() => void setLanguage(language.id)}
            >
              <Text style={styles.optionLabel}>{language.label}</Text>
              <Text style={styles.optionHint}>{language.hint}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(20, 15, 10, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    gap: 4,
  },
  title: { fontSize: 20, fontWeight: '700', color: '#1a1a1a', marginTop: 10 },
  titleEn: { fontSize: 14, color: '#8a8a8a', marginBottom: 12 },
  options: { alignSelf: 'stretch', gap: 10, marginTop: 6 },
  option: {
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2ddd5',
    alignItems: 'center',
  },
  optionPressed: { backgroundColor: '#faf3ef', borderColor: '#c45c3e' },
  optionLabel: { fontSize: 16, fontWeight: '700', color: '#1a1a1a' },
  optionHint: { fontSize: 12, color: '#8a8a8a', marginTop: 2 },
});
