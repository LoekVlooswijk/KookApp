import { ensureDatabaseAsync } from './db';
import { canonicalStoredTagName, isTagHiddenFromBrowseFilters } from './recipeTagSanitize';
import { getCustomDiets } from './dietPrefs';
import { DEFAULT_MANAGED_CATEGORIES, listManagedCategories } from './categoriesRepo';

function normTag(raw: string): string {
  return canonicalStoredTagName(raw.trim().toLowerCase().replace(/\s+/g, ' '));
}

function dietTokenTag(name: string): string {
  return `diet:${name}`;
}

function normCategory(raw: string): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function canonicalCategoryName(normalized: string): string {
  // Keep user-facing default as requested; map common synonym.
  if (normalized === 'nagerecht') return 'toetje';
  return normalized;
}

/**
 * Opschonen van bestaande recepten:
 * - veganistisch → vegan (tag-naam)
 * - zet dieet-tags (vegetarisch/vegan/keto) om naar recipe.diet_* booleans en verwijder ze uit recipe_tags
 * - zet custom diets om naar `diet:<name>` tags (zodat ze niet bij gewone tags komen)
 * - verwijder ruis-tags ("wat eten we..." + maaltijdmomenten) uit recipe_tags
 * - verplaats categorie↔tag op basis van beheerde categorieën (managed_categories + defaults)
 */
export async function cleanupAllRecipeMetadata(): Promise<{ updatedRecipes: number; removedTagLinks: number }> {
  const db = await ensureDatabaseAsync();

  const customDietNames = new Set((await getCustomDiets()).map((d) => d.name));

  const managed = await listManagedCategories();
  const managedCategorySet = new Set(
    [...DEFAULT_MANAGED_CATEGORIES, ...managed].map((c) => canonicalCategoryName(normCategory(c))).filter(Boolean)
  );

  const tagRows = await db.getAllAsync<{ id: number; name: string }>('SELECT id, name FROM tags');
  const tagIdByName = new Map<string, number>();
  for (const t of tagRows) tagIdByName.set(normTag(t.name), t.id);

  const recipes = await db.getAllAsync<{ id: number; category: string | null }>('SELECT id, category FROM recipes');

  let updatedRecipes = 0;
  let removedTagLinks = 0;

  await db.withTransactionAsync(async () => {
    for (const r of recipes) {
      const links = await db.getAllAsync<{ tag_id: number; name: string }>(
        `SELECT t.id as tag_id, t.name as name
         FROM recipe_tags rt
         JOIN tags t ON t.id = rt.tag_id
         WHERE rt.recipe_id = ?`,
        [r.id]
      );

      const curCategoryNorm = canonicalCategoryName(normCategory(r.category ?? ''));
      const curCategoryIsManaged = curCategoryNorm ? managedCategorySet.has(curCategoryNorm) : false;

      let nextCategory: string | null = curCategoryNorm ? (curCategoryIsManaged ? curCategoryNorm : null) : null;
      let dietVegetarian = 0;
      let dietVegan = 0;
      let dietKeto = 0;

      const removeTagIds: number[] = [];

      for (const l of links) {
        const t = normTag(l.name);

        // Hidden browse tags: remove them entirely from links
        if (isTagHiddenFromBrowseFilters(t)) {
          removeTagIds.push(l.tag_id);
          continue;
        }

        // Category tag → category field (only if category is empty).
        const maybeCat = canonicalCategoryName(normCategory(t));
        if (!nextCategory && maybeCat && managedCategorySet.has(maybeCat)) {
          nextCategory = maybeCat;
          removeTagIds.push(l.tag_id);
          continue;
        }

        // If category is already set, remove redundant tag duplicates.
        if (nextCategory && canonicalCategoryName(normCategory(t)) === nextCategory) {
          removeTagIds.push(l.tag_id);
          continue;
        }

        if (t === 'vegan') {
          dietVegan = 1;
          dietVegetarian = 1;
          removeTagIds.push(l.tag_id);
          continue;
        }
        if (t === 'vegetarisch') {
          dietVegetarian = 1;
          removeTagIds.push(l.tag_id);
          continue;
        }
        if (t === 'keto') {
          dietKeto = 1;
          removeTagIds.push(l.tag_id);
          continue;
        }

        // Custom diets: keep as diet:<name> tag so it doesn't clutter normal tags
        const custom = t;
        if (customDietNames.has(custom) && t !== dietTokenTag(custom)) {
          removeTagIds.push(l.tag_id);
          const token = dietTokenTag(custom);
          const tokenId = tagIdByName.get(token);
          if (tokenId) {
            await db.runAsync('INSERT OR IGNORE INTO recipe_tags (recipe_id, tag_id) VALUES (?, ?)', [
              r.id,
              tokenId,
            ]);
          } else {
            await db.runAsync('INSERT OR IGNORE INTO tags (name) VALUES (?)', [token]);
            const row = await db.getFirstAsync<{ id: number }>('SELECT id FROM tags WHERE name = ?', [token]);
            if (row) {
              tagIdByName.set(token, row.id);
              await db.runAsync('INSERT OR IGNORE INTO recipe_tags (recipe_id, tag_id) VALUES (?, ?)', [
                r.id,
                row.id,
              ]);
            }
          }
        }
      }

      // Category field contains something that's not a managed category → convert to tag.
      if (curCategoryNorm && !curCategoryIsManaged) {
        const asTag = normTag(curCategoryNorm);
        if (asTag) {
          const existingId = tagIdByName.get(asTag);
          if (existingId) {
            await db.runAsync('INSERT OR IGNORE INTO recipe_tags (recipe_id, tag_id) VALUES (?, ?)', [
              r.id,
              existingId,
            ]);
          } else {
            await db.runAsync('INSERT OR IGNORE INTO tags (name) VALUES (?)', [asTag]);
            const row = await db.getFirstAsync<{ id: number }>('SELECT id FROM tags WHERE name = ?', [asTag]);
            if (row) {
              tagIdByName.set(asTag, row.id);
              await db.runAsync('INSERT OR IGNORE INTO recipe_tags (recipe_id, tag_id) VALUES (?, ?)', [
                r.id,
                row.id,
              ]);
            }
          }
        }
      }

      if (removeTagIds.length > 0) {
        for (const tid of removeTagIds) {
          const res = await db.runAsync('DELETE FROM recipe_tags WHERE recipe_id = ? AND tag_id = ?', [r.id, tid]);
          removedTagLinks += res.changes ?? 0;
        }
      }

      // Update recipe row if needed.
      const updateDiet =
        dietVegetarian === 1 ||
        dietVegan === 1 ||
        dietKeto === 1 ||
        nextCategory !== (curCategoryIsManaged ? curCategoryNorm : null) ||
        (curCategoryNorm && !curCategoryIsManaged);
      if (updateDiet) {
        await db.runAsync(
          `UPDATE recipes
           SET category = ?, diet_vegetarian = MAX(diet_vegetarian, ?), diet_vegan = MAX(diet_vegan, ?), diet_keto = MAX(diet_keto, ?)
           WHERE id = ?`,
          [nextCategory, dietVegetarian, dietVegan, dietKeto, r.id]
        );
        updatedRecipes += 1;
      }
    }

    // Cleanup orphan tags that are no longer linked.
    await db.runAsync(
      `DELETE FROM tags
       WHERE id NOT IN (SELECT DISTINCT tag_id FROM recipe_tags)`
    );
  });

  return { updatedRecipes, removedTagLinks };
}

