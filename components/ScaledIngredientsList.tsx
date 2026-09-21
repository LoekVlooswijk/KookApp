import { StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from './ThemeContext';
import type { FullRecipe } from '../lib/types';
import { effectiveBaseServings, scaledIngredientDisplayParts, servingFactor } from '../lib/scaling';

type Props = {
  recipe: FullRecipe;
  targetServings: number;
  headerRight?: React.ReactNode;
};

export function ScaledIngredientsList({ recipe, targetServings, headerRight }: Props) {
  const theme = useAppTheme();
  const factor = servingFactor(targetServings, recipe.baseServings);
  const base = effectiveBaseServings(recipe.baseServings);

  return (
    <View style={styles.wrap}>
      <View style={styles.headingRow}>
        <Text style={[styles.heading, { color: theme.accent }]}>Ingrediënten</Text>
        {headerRight}
      </View>
      {targetServings !== base ? (
        <Text style={styles.hint}>
          Geschaald voor {targetServings} persoon{targetServings === 1 ? '' : 'en'} (×
          {trimFactor(factor)})
        </Text>
      ) : null}
      {recipe.ingredientGroups.map((g) => (
        <View key={g.id} style={styles.group}>
          {g.title ? <Text style={styles.groupTitle}>{g.title}</Text> : null}
          <View style={styles.table}>
            {g.ingredients.map((i, idx) => {
              const { qty, name } = scaledIngredientDisplayParts(i.amount, i.unit, i.name, factor);
              const last = idx === g.ingredients.length - 1;
              return (
                <View key={i.id} style={[styles.row, !last && styles.rowBorder]}>
                  <Text style={[styles.qtyCell, !qty && styles.qtyCellEmpty]} numberOfLines={2}>
                    {qty || '—'}
                  </Text>
                  <View style={styles.colDivider} />
                  <Text style={styles.nameCell} numberOfLines={4}>
                    {name}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

function trimFactor(f: number): string {
  const t = Math.round(f * 100) / 100;
  if (Math.abs(t - Math.round(t)) < 1e-6) return String(Math.round(t));
  return String(t).replace(/\.?0+$/, '');
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 8 },
  heading: { fontSize: 17, fontWeight: '700', marginBottom: 6 },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  hint: { fontSize: 13, color: '#666', marginBottom: 10 },
  group: { marginBottom: 14 },
  groupTitle: { fontSize: 14, fontWeight: '600', color: '#555', marginBottom: 6 },
  table: {
    borderWidth: 1,
    borderColor: '#e4e0d8',
    borderRadius: 8,
    backgroundColor: '#fff',
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
    minHeight: 40,
  },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#dcd8cf',
  },
  qtyCell: {
    width: '30%',
    maxWidth: 112,
    paddingVertical: 9,
    paddingLeft: 10,
    paddingRight: 8,
    fontSize: 15,
    lineHeight: 20,
    color: '#333',
    textAlign: 'right',
  },
  qtyCellEmpty: {
    color: '#bbb',
  },
  colDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: '#e4e0d8',
  },
  nameCell: {
    flex: 1,
    paddingVertical: 9,
    paddingLeft: 10,
    paddingRight: 10,
    fontSize: 15,
    lineHeight: 20,
    color: '#1a1a1a',
  },
});
