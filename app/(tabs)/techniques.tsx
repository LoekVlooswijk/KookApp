import { StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '../../components/ThemeContext';

export default function TechniquesScreen() {
  const theme = useAppTheme();
  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Text style={styles.title}>Technieken</Text>
      <Text style={styles.sub}>Komt in plan feature 9.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24 },
  title: { fontSize: 22, fontWeight: '600', marginBottom: 8 },
  sub: { fontSize: 15, color: '#555' },
});
