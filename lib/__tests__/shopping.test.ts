import { mergeAggregatedShoppingItems, normUnit } from '../shopping';

describe('shopping aggregation', () => {
  it('normUnit maps common aliases', () => {
    expect(normUnit('gram')).toBe('g');
    expect(normUnit('eetlepel')).toBe('el');
  });

  it('mergeAggregatedShoppingItems sums same line', () => {
    const out = mergeAggregatedShoppingItems([
      { name: 'melk', amount: 100, unit: 'ml' },
      { name: 'melk', amount: 200, unit: 'ml' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.amount).toBe(300);
  });

  it('merges knoflook variant names conservatively', () => {
    const out = mergeAggregatedShoppingItems([
      { name: 'knoflookteen', amount: 2, unit: 'stuks' },
      { name: 'knoflook teentje', amount: 1, unit: 'stuks' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.amount).toBe(3);
  });
});
