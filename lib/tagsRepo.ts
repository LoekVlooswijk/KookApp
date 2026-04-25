import { ensureDatabaseAsync } from './db';
import { canonicalStoredTagName, isTagHiddenFromBrowseFilters } from './recipeTagSanitize';

function normalizeTagName(raw: string): string {
  return canonicalStoredTagName(
    String(raw ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
  );
}

function isSpecialTag(name: string): boolean {
  const n = normalizeTagName(name);
  if (!n) return true;
  // Diet tags should be managed via the diet UI (built-in booleans + custom diets list).
  if (n === 'vegetarisch' || n === 'vegan' || n === 'keto') return true;
  if (n.startsWith('diet:')) return true;
  return false;
}

export async function listManagedTags(): Promise<string[]> {
  const db = await ensureDatabaseAsync();
  const rows = await db.getAllAsync<{ name: string }>(
    `SELECT name FROM tags
     ORDER BY name COLLATE NOCASE ASC`
  );
  return rows
    .map((r) => r.name)
    .filter((name) => name && !isSpecialTag(name) && !isTagHiddenFromBrowseFilters(name));
}

export async function addManagedTag(name: string): Promise<string[]> {
  const n = normalizeTagName(name);
  if (!n) return listManagedTags();
  if (isSpecialTag(n) || isTagHiddenFromBrowseFilters(n)) {
    throw new Error('Deze tag is gereserveerd en kan hier niet worden toegevoegd.');
  }
  const db = await ensureDatabaseAsync();
  await db.runAsync('INSERT OR IGNORE INTO tags (name) VALUES (?)', [n]);
  return listManagedTags();
}

export async function getManagedTagUsageCount(name: string): Promise<number> {
  const n = normalizeTagName(name);
  if (!n) return 0;
  const db = await ensureDatabaseAsync();
  const row = await db.getFirstAsync<{ c: number }>(
    `SELECT COUNT(*) as c
     FROM recipe_tags rt
     JOIN tags t ON t.id = rt.tag_id
     WHERE t.name = ?`,
    [n]
  );
  return row?.c ?? 0;
}

export async function deleteManagedTagEverywhere(
  name: string
): Promise<{ removedLinks: number; removedTagRow: boolean }> {
  const n = normalizeTagName(name);
  if (!n) return { removedLinks: 0, removedTagRow: false };
  if (isSpecialTag(n)) {
    throw new Error('Deze tag is speciaal en kan niet via Tags beheren worden verwijderd.');
  }

  const db = await ensureDatabaseAsync();
  let out: { removedLinks: number; removedTagRow: boolean } = { removedLinks: 0, removedTagRow: false };
  await db.withTransactionAsync(async () => {
    const tagRow = await db.getFirstAsync<{ id: number }>('SELECT id FROM tags WHERE name = ?', [n]);
    if (!tagRow) {
      out = { removedLinks: 0, removedTagRow: false };
      return;
    }

    const resLinks = await db.runAsync('DELETE FROM recipe_tags WHERE tag_id = ?', [tagRow.id]);
    const resTag = await db.runAsync('DELETE FROM tags WHERE id = ?', [tagRow.id]);

    out = {
      removedLinks: resLinks.changes ?? 0,
      removedTagRow: (resTag.changes ?? 0) > 0,
    };
  });
  return out;
}

