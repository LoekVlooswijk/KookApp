import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from './ThemeContext';
import { MAX_SERVINGS, MIN_SERVINGS, effectiveBaseServings } from '../lib/scaling';

type Props = {
  baseServings: number | null | undefined;
  value: number;
  onChange: (n: number) => void;
  /** Geen titel/uitleg; kleinere knoppen (bijv. receptdetail). */
  compact?: boolean;
};

export function PortionScaler({ baseServings, value, onChange, compact }: Props) {
  const theme = useAppTheme();
  if (compact) {
    return (
      <View style={styles.wrapCompact}>
        <View style={styles.rowCompact}>
          <Pressable
            style={[
              styles.btnCompact,
              { backgroundColor: theme.accent },
              value <= MIN_SERVINGS && styles.btnDisabled,
            ]}
            disabled={value <= MIN_SERVINGS}
            onPress={() => onChange(Math.max(MIN_SERVINGS, value - 1))}
          >
            <Text style={styles.btnTextCompact}>−</Text>
          </Pressable>
          <View style={styles.valueColCompact}>
            <Text style={styles.valueCompact}>{value}</Text>
            <Text style={styles.suffixBelow}>pers.</Text>
          </View>
          <Pressable
            style={[
              styles.btnCompact,
              { backgroundColor: theme.accent },
              value >= MAX_SERVINGS && styles.btnDisabled,
            ]}
            disabled={value >= MAX_SERVINGS}
            onPress={() => onChange(Math.min(MAX_SERVINGS, value + 1))}
          >
            <Text style={styles.btnTextCompact}>+</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const base = effectiveBaseServings(baseServings);

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Porties</Text>
      <Text style={styles.sub}>
        Recept is voor {base} persoon{base === 1 ? '' : 'en'}. Pas aan wat je nu kookt.
      </Text>
      <View style={styles.row}>
        <Pressable
          style={[
            styles.btn,
            { backgroundColor: theme.accent },
            value <= MIN_SERVINGS && styles.btnDisabled,
          ]}
          disabled={value <= MIN_SERVINGS}
          onPress={() => onChange(Math.max(MIN_SERVINGS, value - 1))}
        >
          <Text style={styles.btnText}>−</Text>
        </Pressable>
        <Text style={styles.value}>{value}</Text>
        <Pressable
          style={[
            styles.btn,
            { backgroundColor: theme.accent },
            value >= MAX_SERVINGS && styles.btnDisabled,
          ]}
          disabled={value >= MAX_SERVINGS}
          onPress={() => onChange(Math.min(MAX_SERVINGS, value + 1))}
        >
          <Text style={styles.btnText}>+</Text>
        </Pressable>
        <Text style={styles.suffix}>personen</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2ddd5',
    padding: 14,
    marginBottom: 16,
  },
  title: { fontSize: 16, fontWeight: '700', color: '#1a1a1a', marginBottom: 4 },
  sub: { fontSize: 13, color: '#666', marginBottom: 12, lineHeight: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  btn: {
    minWidth: 44,
    height: 44,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.35 },
  btnText: { color: '#fff', fontSize: 22, fontWeight: '600', lineHeight: 26 },
  value: { fontSize: 22, fontWeight: '700', minWidth: 36, textAlign: 'center', color: '#1a1a1a' },
  suffix: { fontSize: 15, color: '#555', marginLeft: 4 },
  wrapCompact: { justifyContent: 'center' },
  rowCompact: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  valueColCompact: { alignItems: 'center', justifyContent: 'center', minWidth: 26 },
  suffixBelow: { fontSize: 10, fontWeight: '600', color: '#777', marginTop: -1 },
  btnCompact: {
    minWidth: 34,
    height: 34,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnTextCompact: { color: '#fff', fontSize: 18, fontWeight: '600', lineHeight: 22 },
  valueCompact: { fontSize: 17, fontWeight: '700', textAlign: 'center', color: '#1a1a1a' },
});
