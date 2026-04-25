import { ensureDatabaseAsync } from './db';
import type { RecipeListItem } from './types';

function isoNow(): string {
  return new Date().toISOString();
}

export type RecipeListSummary = {
  id: number;
  name: string;
  description: string | null;
  recipeCount: number;
  updatedAt: string;
};

export type RecipeListMeta = {
  id: number;
  name: string;
  description: string | null;
};

export async function listAllLists(): Promise<RecipeListSummary[]> {
  const db = await ensureDatabaseAsync();
  const rows = await db.getAllAsync<{
    id: number;
    name: string;
    description: string | null;
    sort_order: number;
    updated_at: string;
  }>(
    `SELECT l.id, l.name, l.description, l.sort_order, l.updated_at
     FROM recipe_lists l
     ORDER BY l.sort_order ASC, l.name COLLATE NOCASE ASC`
  );
  const result: RecipeListSummary[] = [];
  for (const r of rows) {
    const c = await db.getFirstAsync<{ n: number }>(
      'SELECT COUNT(*) as n FROM recipe_list_items WHERE list_id = ?',
      [r.id]
    );
    result.push({
      id: r.id,
      name: r.name,
      description: r.description,
      recipeCount: c?.n ?? 0,
      updatedAt: r.updated_at,
    });
  }
  return result;
}

export async function getListMeta(listId: number): Promise<RecipeListMeta | null> {
  const db = await ensureDatabaseAsync();
  const r = await db.getFirstAsync<{
    id: number;
    name: string;
    description: string | null;
  }>('SELECT id, name, description FROM recipe_lists WHERE id = ?', [listId]);
  return r ? { id: r.id, name: r.name, description: r.description } : null;
}

export async function createList(name: string, description?: string): Promise<number> {
  const db = await ensureDatabaseAsync();
  const now = isoNow();
  const maxRow = await db.getFirstAsync<{ m: number | null }>(
    'SELECT MAX(sort_order) as m FROM recipe_lists'
  );
  const sortOrder = (maxRow?.m ?? -1) + 1;
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Naam mag niet leeg zijn.');
  const res = await db.runAsync(
    'INSERT INTO recipe_lists (name, description, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    [trimmed, description?.trim() || null, sortOrder, now, now]
  );
  return Number(res.lastInsertRowId);
}

export async function deleteList(listId: number): Promise<void> {
  const db = await ensureDatabaseAsync();
  await db.runAsync('DELETE FROM recipe_lists WHERE id = ?', [listId]);
}

export async function getRecipesInList(listId: number): Promise<RecipeListItem[]> {
  const db = await ensureDatabaseAsync();
  const rows = await db.getAllAsync<{
    id: number;
    title: string;
    category: string | null;
    updated_at: string;
    is_favorite: number;
    want_to_try: number;
    image_uri: string | null;
  }>(
    `SELECT r.id, r.title, r.category, r.updated_at, r.is_favorite, r.want_to_try, r.image_uri
     FROM recipes r
     INNER JOIN recipe_list_items i ON i.recipe_id = r.id
     WHERE i.list_id = ?
     ORDER BY i.sort_order ASC, r.title COLLATE NOCASE ASC`,
    [listId]
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    category: r.category,
    updatedAt: r.updated_at,
    isFavorite: r.is_favorite === 1,
    wantToTry: r.want_to_try === 1,
    imageUri: r.image_uri,
  }));
}

export async function addRecipeToList(listId: number, recipeId: number): Promise<void> {
  const db = await ensureDatabaseAsync();
  const now = isoNow();
  const exists = await db.getFirstAsync<{ c: number }>(
    'SELECT COUNT(*) as c FROM recipe_list_items WHERE list_id = ? AND recipe_id = ?',
    [listId, recipeId]
  );
  if (exists && exists.c > 0) return;
  const maxRow = await db.getFirstAsync<{ m: number | null }>(
    'SELECT MAX(sort_order) as m FROM recipe_list_items WHERE list_id = ?',
    [listId]
  );
  const sortOrder = (maxRow?.m ?? -1) + 1;
  await db.runAsync(
    'INSERT INTO recipe_list_items (list_id, recipe_id, sort_order) VALUES (?, ?, ?)',
    [listId, recipeId, sortOrder]
  );
  await db.runAsync('UPDATE recipe_lists SET updated_at = ? WHERE id = ?', [now, listId]);
}

export async function addRecipesToList(listId: number, recipeIds: number[]): Promise<void> {
  const db = await ensureDatabaseAsync();
  const ids = Array.from(
    new Set(
      (Array.isArray(recipeIds) ? recipeIds : [])
        .map((x) => Number(x))
        .filter((x) => Number.isFinite(x))
    )
  );
  if (ids.length === 0) return;

  const now = isoNow();

  await db.withTransactionAsync(async () => {
    const existingRows = await db.getAllAsync<{ recipe_id: number }>(
      'SELECT recipe_id FROM recipe_list_items WHERE list_id = ?',
      [listId]
    );
    const existing = new Set(existingRows.map((r) => r.recipe_id));
    const toInsert = ids.filter((id) => !existing.has(id));
    if (toInsert.length === 0) return;

    const maxRow = await db.getFirstAsync<{ m: number | null }>(
      'SELECT MAX(sort_order) as m FROM recipe_list_items WHERE list_id = ?',
      [listId]
    );
    let sortOrder = (maxRow?.m ?? -1) + 1;

    for (const recipeId of toInsert) {
      await db.runAsync(
        'INSERT OR IGNORE INTO recipe_list_items (list_id, recipe_id, sort_order) VALUES (?, ?, ?)',
        [listId, recipeId, sortOrder]
      );
      sortOrder += 1;
    }

    await db.runAsync('UPDATE recipe_lists SET updated_at = ? WHERE id = ?', [now, listId]);
  });
}

export async function removeRecipeFromList(listId: number, recipeId: number): Promise<void> {
  const db = await ensureDatabaseAsync();
  const now = isoNow();
  await db.runAsync('DELETE FROM recipe_list_items WHERE list_id = ? AND recipe_id = ?', [
    listId,
    recipeId,
  ]);
  await db.runAsync('UPDATE recipe_lists SET updated_at = ? WHERE id = ?', [now, listId]);
}

/** Alle lijsten met vlag of dit recept erin zit (voor toggles op detail). */
export async function getRecipeListMembership(recipeId: number): Promise<
  {
    id: number;
    name: string;
    member: boolean;
  }[]
> {
  const db = await ensureDatabaseAsync();
  const lists = await db.getAllAsync<{ id: number; name: string }>(
    'SELECT id, name FROM recipe_lists ORDER BY sort_order ASC, name COLLATE NOCASE ASC'
  );
  const memberRows = await db.getAllAsync<{ list_id: number }>(
    'SELECT list_id FROM recipe_list_items WHERE recipe_id = ?',
    [recipeId]
  );
  const member = new Set(memberRows.map((r) => r.list_id));
  return lists.map((l) => ({ id: l.id, name: l.name, member: member.has(l.id) }));
}

export async function setRecipeInList(
  listId: number,
  recipeId: number,
  inList: boolean
): Promise<void> {
  if (inList) await addRecipeToList(listId, recipeId);
  else await removeRecipeFromList(listId, recipeId);
}

/** Recepten die nog niet in deze lijst zitten (voor toevoegen-modal). */
export async function listRecipesNotInList(listId: number): Promise<RecipeListItem[]> {
  const db = await ensureDatabaseAsync();
  const rows = await db.getAllAsync<{
    id: number;
    title: string;
    category: string | null;
    updated_at: string;
    is_favorite: number;
    want_to_try: number;
    image_uri: string | null;
  }>(
    `SELECT r.id, r.title, r.category, r.updated_at, r.is_favorite, r.want_to_try, r.image_uri
     FROM recipes r
     WHERE r.id NOT IN (
       SELECT recipe_id FROM recipe_list_items WHERE list_id = ?
     )
     ORDER BY datetime(r.updated_at) DESC`,
    [listId]
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    category: r.category,
    updatedAt: r.updated_at,
    isFavorite: r.is_favorite === 1,
    wantToTry: r.want_to_try === 1,
    imageUri: r.image_uri,
  }));
}
