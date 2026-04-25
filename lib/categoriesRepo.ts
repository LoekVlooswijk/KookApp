import { ensureDatabaseAsync } from './db';

function normalizeCategoryName(raw: string): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export const DEFAULT_MANAGED_CATEGORIES = [
  'hoofdgerecht',
  'voorgerecht',
  'toetje',
  'bijgerecht',
  'snack',
] as const;

export async function listManagedCategories(): Promise<string[]> {
  const db = await ensureDatabaseAsync();
  const rows = await db.getAllAsync<{ name: string }>(
    `SELECT name FROM managed_categories
     ORDER BY name COLLATE NOCASE ASC`
  );
  return rows.map((r) => r.name).filter(Boolean);
}

export async function addManagedCategory(name: string): Promise<string[]> {
  const n = normalizeCategoryName(name);
  if (!n) return listManagedCategories();
  const db = await ensureDatabaseAsync();
  await db.runAsync('INSERT OR IGNORE INTO managed_categories (name) VALUES (?)', [n]);
  return listManagedCategories();
}

export async function getManagedCategoryUsageCount(name: string): Promise<number> {
  const n = normalizeCategoryName(name);
  if (!n) return 0;
  const db = await ensureDatabaseAsync();
  const row = await db.getFirstAsync<{ c: number }>(
    `SELECT COUNT(*) as c
     FROM recipes
     WHERE TRIM(LOWER(category)) = ?`,
    [n]
  );
  return row?.c ?? 0;
}

export async function deleteManagedCategoryEverywhere(
  name: string
): Promise<{ clearedRecipes: number; removedRow: boolean }> {
  const n = normalizeCategoryName(name);
  if (!n) return { clearedRecipes: 0, removedRow: false };
  const db = await ensureDatabaseAsync();
  let out: { clearedRecipes: number; removedRow: boolean } = { clearedRecipes: 0, removedRow: false };
  await db.withTransactionAsync(async () => {
    const cleared = await db.runAsync(
      `UPDATE recipes
       SET category = NULL
       WHERE TRIM(LOWER(category)) = ?`,
      [n]
    );
    const removed = await db.runAsync('DELETE FROM managed_categories WHERE name = ?', [n]);
    out = { clearedRecipes: cleared.changes ?? 0, removedRow: (removed.changes ?? 0) > 0 };
  });
  return out;
}

