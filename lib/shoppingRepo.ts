import { ensureDatabaseAsync } from './db';
import { mergeAggregatedShoppingItems } from './shopping';

export type ShoppingItemRow = {
  id: number;
  planId: number | null;
  name: string;
  amount: number | null;
  unit: string | null;
  isChecked: boolean;
  category: string | null;
};

export const SHOPPING_INTERNAL_CATEGORY_WEEK = '__week__';

function clampAmount(n: number | null): number | null {
  if (n == null) return null;
  if (!Number.isFinite(n)) return null;
  const x = Math.round(n * 100) / 100;
  return x === 0 ? 0 : x;
}

export async function listShoppingItems(): Promise<ShoppingItemRow[]> {
  const db = await ensureDatabaseAsync();
  const rows = await db.getAllAsync<{
    id: number;
    plan_id: number | null;
    name: string;
    amount: number | null;
    unit: string | null;
    is_checked: number;
    category: string | null;
  }>(
    `SELECT id, plan_id, name, amount, unit, is_checked, category
     FROM shopping_items
     ORDER BY is_checked ASC, LOWER(name) ASC, id ASC`
  );
  return rows.map((r) => ({
    id: r.id,
    planId: r.plan_id,
    name: r.name,
    amount: r.amount,
    unit: r.unit,
    isChecked: r.is_checked === 1,
    category: r.category,
  }));
}

export async function addManualShoppingItem(params: {
  name: string;
  amount?: number | null;
  unit?: string | null;
}): Promise<void> {
  const db = await ensureDatabaseAsync();
  const name = params.name.trim();
  if (!name) return;
  await db.runAsync(
    'INSERT INTO shopping_items (plan_id, name, amount, unit, is_checked, category) VALUES (?, ?, ?, ?, 0, ?)',
    [null, name, clampAmount(params.amount ?? null), (params.unit ?? '').trim() || null, null]
  );
}

export async function toggleShoppingItemChecked(id: number, checked: boolean): Promise<void> {
  const db = await ensureDatabaseAsync();
  await db.runAsync('UPDATE shopping_items SET is_checked = ? WHERE id = ?', [checked ? 1 : 0, id]);
}

export async function deleteShoppingItem(id: number): Promise<void> {
  const db = await ensureDatabaseAsync();
  await db.runAsync('DELETE FROM shopping_items WHERE id = ?', [id]);
}

export async function clearWeekShoppingItems(): Promise<void> {
  const db = await ensureDatabaseAsync();
  await db.runAsync('DELETE FROM shopping_items WHERE category = ?', [
    SHOPPING_INTERNAL_CATEGORY_WEEK,
  ]);
}

export async function insertWeekShoppingItems(
  items: { name: string; amount: number | null; unit: string | null }[]
): Promise<void> {
  const merged = mergeAggregatedShoppingItems(items);
  const db = await ensureDatabaseAsync();
  await db.withTransactionAsync(async () => {
    for (const it of merged) {
      const name = it.name.trim();
      if (!name) continue;
      await db.runAsync(
        'INSERT INTO shopping_items (plan_id, name, amount, unit, is_checked, category) VALUES (?, ?, ?, ?, 0, ?)',
        [
          null,
          name,
          clampAmount(it.amount),
          (it.unit ?? '').trim() || null,
          SHOPPING_INTERNAL_CATEGORY_WEEK,
        ]
      );
    }
  });
}
