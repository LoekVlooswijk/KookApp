import * as SQLite from 'expo-sqlite';

import { ensureDatabaseAsync } from './db';
import { tryDeleteManagedCover } from './recipeCoverStorage';
import { canonicalStoredTagName, isTagHiddenFromBrowseFilters } from './recipeTagSanitize';
import type {
  FullRecipe,
  IngredientGroupRow,
  IngredientRow,
  RecipeListItem,
  RecipeSavePayload,
  StepRow,
  StepSectionRow,
} from './types';

type SQLiteDatabase = SQLite.SQLiteDatabase;

function isoNow(): string {
  return new Date().toISOString();
}

function normalizeTag(raw: string): string {
  return raw.trim().toLowerCase();
}

function escapeLikeFragment(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export type RecipeBrowseFilters = {
  query: string;
  /** Exacte categorie; `null` = geen filter. */
  category: string | null;
  /** Exacte tags (namen in DB = lowercase); leeg = geen filter. AND-logica. */
  tagNames: string[];
  /** Dieetfilters: subset van keys ['vegetarian','vegan','keto']; AND-logica. */
  dietKeys: string[];
  /** Extra diëten (namen) uit Instellingen; AND-logica. */
  customDietNames: string[];
  favoritesOnly: boolean;
  wantToTryOnly: boolean;
  /** Alleen recepten met `total_time_min` ingevuld en ≤ deze waarde. */
  maxTotalTimeMin: number | null;
  /** Alleen recepten in deze lijst; `null` = alle recepten. */
  inListId: number | null;
};

function mapRecipeListRow(r: {
  id: number;
  title: string;
  category: string | null;
  updated_at: string;
  is_favorite: number;
  want_to_try: number;
  image_uri: string | null;
}): RecipeListItem {
  return {
    id: r.id,
    title: r.title,
    category: r.category,
    updatedAt: r.updated_at,
    isFavorite: r.is_favorite === 1,
    wantToTry: r.want_to_try === 1,
    imageUri: r.image_uri,
  };
}

export async function countRecipes(): Promise<number> {
  const db = await ensureDatabaseAsync();
  const row = await db.getFirstAsync<{ c: number }>('SELECT COUNT(*) as c FROM recipes');
  return row?.c ?? 0;
}

export async function listDistinctRecipeCategories(): Promise<string[]> {
  const db = await ensureDatabaseAsync();
  const rows = await db.getAllAsync<{ c: string }>(
    `SELECT DISTINCT TRIM(category) as c FROM recipes
     WHERE category IS NOT NULL AND TRIM(category) != ''
     ORDER BY c COLLATE NOCASE ASC`
  );
  return rows.map((x) => x.c);
}

export async function listDistinctRecipeTags(): Promise<string[]> {
  const db = await ensureDatabaseAsync();
  const rows = await db.getAllAsync<{ name: string }>(
    `SELECT DISTINCT t.name as name
     FROM tags t
     INNER JOIN recipe_tags rt ON rt.tag_id = t.id
     ORDER BY t.name COLLATE NOCASE ASC`
  );
  return rows.map((x) => x.name).filter((name) => !isTagHiddenFromBrowseFilters(name));
}

/** Zoeken op titel, omschrijving, categorie, ingrediëntnamen en tags; optioneel filteren. */
export async function searchRecipes(f: RecipeBrowseFilters): Promise<RecipeListItem[]> {
  const db = await ensureDatabaseAsync();
  const where: string[] = ['1=1'];
  const params: (string | number)[] = [];

  const q = f.query.trim();
  if (q.length > 0) {
    const pattern = `%${escapeLikeFragment(q.toLowerCase())}%`;
    where.push(`(
      LOWER(r.title) LIKE ? ESCAPE '\\' OR
      (r.description IS NOT NULL AND LOWER(r.description) LIKE ? ESCAPE '\\') OR
      (r.category IS NOT NULL AND LOWER(r.category) LIKE ? ESCAPE '\\') OR
      EXISTS (
        SELECT 1 FROM ingredients ing
        WHERE ing.recipe_id = r.id AND LOWER(ing.name) LIKE ? ESCAPE '\\'
      ) OR
      EXISTS (
        SELECT 1 FROM recipe_tags rtx
        JOIN tags tg ON tg.id = rtx.tag_id
        WHERE rtx.recipe_id = r.id AND LOWER(tg.name) LIKE ? ESCAPE '\\'
      ) OR
      EXISTS (
        SELECT 1 FROM steps st
        WHERE st.recipe_id = r.id AND LOWER(st.description) LIKE ? ESCAPE '\\'
      )
    )`);
    params.push(pattern, pattern, pattern, pattern, pattern, pattern);
  }

  if (f.category != null && f.category !== '') {
    where.push('r.category = ?');
    params.push(f.category);
  }

  const dietInputs = Array.isArray(f.dietKeys) ? f.dietKeys : [];
  const dietSet = new Set(dietInputs.map((d) => String(d).trim().toLowerCase()).filter(Boolean));
  for (const d of dietSet) {
    if (d === 'vegetarian') {
      // Vegan ⊂ vegetarisch
      where.push('(r.diet_vegetarian = 1 OR r.diet_vegan = 1)');
    } else if (d === 'vegan') {
      where.push('r.diet_vegan = 1');
    } else if (d === 'keto') {
      where.push('r.diet_keto = 1');
    }
  }

  const customDietInputs = Array.isArray(f.customDietNames) ? f.customDietNames : [];
  const customDietSet = new Set<string>();
  for (const raw of customDietInputs) {
    const n = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!n) continue;
    customDietSet.add(n);
  }
  for (const n of customDietSet) {
    const token = `diet:${n}`;
    where.push(
      `EXISTS (
        SELECT 1 FROM recipe_tags rtx
        JOIN tags tg ON tg.id = rtx.tag_id
        WHERE rtx.recipe_id = r.id AND tg.name = ?
      )`
    );
    params.push(token);
  }

  const tagInputs = Array.isArray(f.tagNames) ? f.tagNames : [];
  const tagSet = new Set<string>();
  for (const raw of tagInputs) {
    const tn = normalizeTag(raw);
    if (!tn) continue;
    tagSet.add(tn);
  }
  for (const tn of tagSet) {
    where.push(
      `EXISTS (
        SELECT 1 FROM recipe_tags rtx
        JOIN tags tg ON tg.id = rtx.tag_id
        WHERE rtx.recipe_id = r.id AND tg.name = ?
      )`
    );
    params.push(tn);
  }

  if (f.favoritesOnly) {
    where.push('r.is_favorite = 1');
  }

  if (f.wantToTryOnly) {
    where.push('r.want_to_try = 1');
  }

  if (f.maxTotalTimeMin != null && Number.isFinite(f.maxTotalTimeMin)) {
    where.push('r.total_time_min IS NOT NULL AND r.total_time_min <= ?');
    params.push(f.maxTotalTimeMin);
  }

  if (f.inListId != null && Number.isFinite(f.inListId)) {
    where.push(
      'EXISTS (SELECT 1 FROM recipe_list_items rli WHERE rli.recipe_id = r.id AND rli.list_id = ?)'
    );
    params.push(f.inListId);
  }

  const sql = `
    SELECT DISTINCT r.id, r.title, r.category, r.updated_at, r.is_favorite, r.want_to_try, r.image_uri
    FROM recipes r
    WHERE ${where.join(' AND ')}
    ORDER BY datetime(r.updated_at) DESC
  `;
  const rows = await db.getAllAsync<{
    id: number;
    title: string;
    category: string | null;
    updated_at: string;
    is_favorite: number;
    want_to_try: number;
    image_uri: string | null;
  }>(sql, params);
  return rows.map(mapRecipeListRow);
}

export async function listRecipes(): Promise<RecipeListItem[]> {
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
    `SELECT id, title, category, updated_at, is_favorite, want_to_try, image_uri
     FROM recipes
     ORDER BY datetime(updated_at) DESC`
  );
  return rows.map(mapRecipeListRow);
}

export type WeekPlanningRecipePromptItem = {
  id: number;
  title: string;
  total_time_min: number | null;
  category: string | null;
  tags: string[];
  key_ingredients: string[];
  want_to_try: boolean;
};

/**
 * Minimal recipe summaries for week-planning prompts.
 * Avoids loading full recipes; keeps AI context small.
 */
export async function listRecipesForWeekPlanningPrompt(): Promise<WeekPlanningRecipePromptItem[]> {
  const db = await ensureDatabaseAsync();

  const recipes = await db.getAllAsync<{
    id: number;
    title: string;
    total_time_min: number | null;
    category: string | null;
    want_to_try: number;
  }>(
    `SELECT id, title, total_time_min, category, want_to_try
     FROM recipes
     ORDER BY datetime(updated_at) DESC`
  );

  const tagRows = await db.getAllAsync<{ recipe_id: number; name: string }>(
    `SELECT rt.recipe_id as recipe_id, t.name as name
     FROM recipe_tags rt
     JOIN tags t ON t.id = rt.tag_id
     ORDER BY rt.recipe_id ASC, t.name COLLATE NOCASE ASC`
  );
  const tagsByRecipe = new Map<number, string[]>();
  for (const r of tagRows) {
    const arr = tagsByRecipe.get(r.recipe_id) ?? [];
    arr.push(r.name);
    tagsByRecipe.set(r.recipe_id, arr);
  }

  const ingRows = await db.getAllAsync<{ recipe_id: number; name: string }>(
    `SELECT recipe_id, name
     FROM ingredients
     ORDER BY recipe_id ASC, COALESCE(group_id, 0) ASC, order_index ASC, id ASC`
  );
  const keyIngsByRecipe = new Map<number, string[]>();
  for (const r of ingRows) {
    const name = (r.name ?? '').trim();
    if (!name) continue;
    const arr = keyIngsByRecipe.get(r.recipe_id) ?? [];
    if (arr.length >= 6) continue; // keep prompt compact
    arr.push(name);
    keyIngsByRecipe.set(r.recipe_id, arr);
  }

  return recipes.map((r) => ({
    id: r.id,
    title: r.title,
    total_time_min: r.total_time_min,
    category: r.category,
    tags: tagsByRecipe.get(r.id) ?? [],
    key_ingredients: keyIngsByRecipe.get(r.id) ?? [],
    want_to_try: r.want_to_try === 1,
  }));
}

async function loadIngredientGroups(
  db: SQLiteDatabase,
  recipeId: number
): Promise<IngredientGroupRow[]> {
  const groups = await db.getAllAsync<{
    id: number;
    recipe_id: number;
    title: string | null;
    order_index: number;
  }>(
    `SELECT id, recipe_id, title, order_index FROM ingredient_groups
     WHERE recipe_id = ? ORDER BY order_index ASC`,
    [recipeId]
  );
  const out: IngredientGroupRow[] = [];
  for (const g of groups) {
    const ingredients = await db.getAllAsync<{
      id: number;
      recipe_id: number;
      group_id: number | null;
      name: string;
      amount: number | null;
      unit: string | null;
      order_index: number;
    }>(
      `SELECT id, recipe_id, group_id, name, amount, unit, order_index
       FROM ingredients WHERE group_id = ? ORDER BY order_index ASC`,
      [g.id]
    );
    const ingRows: IngredientRow[] = ingredients.map((i) => ({
      id: i.id,
      recipeId: i.recipe_id,
      groupId: i.group_id,
      name: i.name,
      amount: i.amount,
      unit: i.unit,
      orderIndex: i.order_index,
    }));
    out.push({
      id: g.id,
      recipeId: g.recipe_id,
      title: g.title,
      orderIndex: g.order_index,
      ingredients: ingRows,
    });
  }
  return out;
}

async function loadStepSections(db: SQLiteDatabase, recipeId: number): Promise<StepSectionRow[]> {
  const sections = await db.getAllAsync<{
    id: number;
    recipe_id: number;
    title: string | null;
    order_index: number;
  }>(
    `SELECT id, recipe_id, title, order_index FROM step_sections
     WHERE recipe_id = ? ORDER BY order_index ASC`,
    [recipeId]
  );
  const out: StepSectionRow[] = [];
  for (const s of sections) {
    const steps = await db.getAllAsync<{
      id: number;
      recipe_id: number;
      section_id: number | null;
      order_index: number;
      description: string;
      timer_seconds: number | null;
    }>(
      `SELECT id, recipe_id, section_id, order_index, description, timer_seconds
       FROM steps WHERE section_id = ? ORDER BY order_index ASC`,
      [s.id]
    );
    const stepRows: StepRow[] = steps.map((st) => ({
      id: st.id,
      recipeId: st.recipe_id,
      sectionId: st.section_id,
      orderIndex: st.order_index,
      description: st.description,
      timerSeconds: st.timer_seconds,
    }));
    out.push({
      id: s.id,
      recipeId: s.recipe_id,
      title: s.title,
      orderIndex: s.order_index,
      steps: stepRows,
    });
  }
  return out;
}

async function loadTags(db: SQLiteDatabase, recipeId: number): Promise<string[]> {
  const rows = await db.getAllAsync<{ name: string }>(
    `SELECT t.name FROM tags t
     INNER JOIN recipe_tags rt ON rt.tag_id = t.id
     WHERE rt.recipe_id = ?
     ORDER BY t.name ASC`,
    [recipeId]
  );
  return rows.map((r) => r.name);
}

export async function getFullRecipe(id: number): Promise<FullRecipe | null> {
  const db = await ensureDatabaseAsync();
  const r = await db.getFirstAsync<{
    id: number;
    title: string;
    description: string | null;
    source_url: string | null;
    base_servings: number | null;
    prep_time_min: number | null;
    cook_time_min: number | null;
    total_time_min: number | null;
    category: string | null;
    diet_vegetarian?: number;
    diet_vegan?: number;
    diet_keto?: number;
    is_favorite: number;
    want_to_try: number;
    notes: string | null;
    image_uri: string | null;
    created_at: string;
    updated_at: string;
  }>('SELECT * FROM recipes WHERE id = ?', [id]);
  if (!r) return null;
  const [ingredientGroups, stepSections, tags] = await Promise.all([
    loadIngredientGroups(db, id),
    loadStepSections(db, id),
    loadTags(db, id),
  ]);
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    sourceUrl: r.source_url,
    baseServings: r.base_servings,
    prepTimeMin: r.prep_time_min,
    cookTimeMin: r.cook_time_min,
    totalTimeMin: r.total_time_min,
    category: r.category,
    dietVegetarian: (r.diet_vegetarian ?? 0) === 1,
    dietVegan: (r.diet_vegan ?? 0) === 1,
    dietKeto: (r.diet_keto ?? 0) === 1,
    isFavorite: r.is_favorite === 1,
    wantToTry: r.want_to_try === 1,
    notes: r.notes,
    imageUri: r.image_uri,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    ingredientGroups,
    stepSections,
    tags,
  };
}

async function insertNested(
  db: SQLiteDatabase,
  recipeId: number,
  payload: RecipeSavePayload
): Promise<void> {
  let gOrder = 0;
  for (const g of payload.ingredientGroups) {
    const gr = await db.runAsync(
      'INSERT INTO ingredient_groups (recipe_id, title, order_index) VALUES (?, ?, ?)',
      [recipeId, g.title.trim() || null, gOrder]
    );
    const groupId = Number(gr.lastInsertRowId);
    let iOrder = 0;
    for (const ing of g.ingredients) {
      if (!ing.name.trim()) continue;
      await db.runAsync(
        'INSERT INTO ingredients (recipe_id, group_id, name, amount, unit, order_index) VALUES (?, ?, ?, ?, ?, ?)',
        [
          recipeId,
          groupId,
          ing.name.trim(),
          ing.amount,
          ing.unit?.trim() || null,
          iOrder,
        ]
      );
      iOrder += 1;
    }
    gOrder += 1;
  }

  let sOrder = 0;
  for (const sec of payload.stepSections) {
    const sr = await db.runAsync(
      'INSERT INTO step_sections (recipe_id, title, order_index) VALUES (?, ?, ?)',
      [recipeId, sec.title.trim() || null, sOrder]
    );
    const sectionId = Number(sr.lastInsertRowId);
    let stOrder = 0;
    for (const st of sec.steps) {
      if (!st.description.trim()) continue;
      await db.runAsync(
        'INSERT INTO steps (recipe_id, section_id, order_index, description, timer_seconds) VALUES (?, ?, ?, ?, ?)',
        [recipeId, sectionId, stOrder, st.description.trim(), st.timerSeconds]
      );
      stOrder += 1;
    }
    sOrder += 1;
  }
}

async function linkTags(
  db: SQLiteDatabase,
  recipeId: number,
  tagNames: string[]
): Promise<void> {
  const seen = new Set<string>();
  for (const raw of tagNames) {
    const name = canonicalStoredTagName(normalizeTag(raw));
    // Dieetlabels zitten in eigen velden; niet als tag opslaan.
    if (name === 'vegetarisch' || name === 'vegan' || name === 'keto') continue;
    if (!name || seen.has(name)) continue;
    seen.add(name);
    await db.runAsync('INSERT OR IGNORE INTO tags (name) VALUES (?)', [name]);
    const row = await db.getFirstAsync<{ id: number }>('SELECT id FROM tags WHERE name = ?', [name]);
    if (!row) continue;
    await db.runAsync(
      'INSERT OR IGNORE INTO recipe_tags (recipe_id, tag_id) VALUES (?, ?)',
      [recipeId, row.id]
    );
  }
}

export async function createRecipe(payload: RecipeSavePayload): Promise<number> {
  const db = await ensureDatabaseAsync();
  const now = isoNow();
  let recipeId = 0;
  await db.withTransactionAsync(async () => {
    const r = await db.runAsync(
      `INSERT INTO recipes (title, description, source_url, base_servings, prep_time_min, cook_time_min, total_time_min,
        category, diet_vegetarian, diet_vegan, diet_keto, is_favorite, want_to_try, notes, image_uri, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.title.trim(),
        payload.description.trim() || null,
        payload.sourceUrl.trim() || null,
        payload.baseServings,
        payload.prepTimeMin,
        payload.cookTimeMin,
        payload.totalTimeMin,
        payload.category.trim() || null,
        payload.dietVegetarian ? 1 : 0,
        payload.dietVegan ? 1 : 0,
        payload.dietKeto ? 1 : 0,
        payload.isFavorite ? 1 : 0,
        payload.wantToTry ? 1 : 0,
        payload.notes.trim() || null,
        payload.imageUri.trim() || null,
        now,
        now,
      ]
    );
    recipeId = Number(r.lastInsertRowId);
    await insertNested(db, recipeId, payload);
    await linkTags(db, recipeId, payload.tagNames);
  });
  return recipeId;
}

function fullRecipeToSavePayload(r: FullRecipe): RecipeSavePayload {
  return {
    title: r.title,
    description: r.description ?? '',
    sourceUrl: r.sourceUrl ?? '',
    baseServings: r.baseServings ?? 4,
    prepTimeMin: r.prepTimeMin ?? null,
    cookTimeMin: r.cookTimeMin ?? null,
    totalTimeMin: r.totalTimeMin ?? null,
    category: r.category ?? '',
    dietVegetarian: !!r.dietVegetarian,
    dietVegan: !!r.dietVegan,
    dietKeto: !!r.dietKeto,
    isFavorite: !!r.isFavorite,
    wantToTry: !!r.wantToTry,
    notes: r.notes ?? '',
    imageUri: r.imageUri ?? '',
    tagNames: Array.isArray(r.tags) ? [...r.tags] : [],
    ingredientGroups: (r.ingredientGroups ?? []).map((g) => ({
      title: g.title ?? '',
      ingredients: (g.ingredients ?? []).map((ing) => ({
        name: ing.name ?? '',
        amount: ing.amount ?? null,
        unit: ing.unit ?? null,
      })),
    })),
    stepSections: (r.stepSections ?? []).map((s) => ({
      title: s.title ?? '',
      steps: (s.steps ?? []).map((st) => ({
        description: st.description ?? '',
        timerSeconds: st.timerSeconds ?? null,
      })),
    })),
  };
}

export async function duplicateRecipe(params: {
  recipeId: number;
  /** Optioneel: als je de kopie meteen aan een lijst wil koppelen. */
  addToListId?: number | null;
}): Promise<number> {
  const base = await getFullRecipe(params.recipeId);
  if (!base) {
    throw new Error('Recept niet gevonden.');
  }
  const payload = fullRecipeToSavePayload(base);
  payload.title = `${payload.title} (kopie)`;
  payload.isFavorite = false;

  const newId = await createRecipe(payload);

  if (params.addToListId != null && Number.isFinite(params.addToListId)) {
    const db = await ensureDatabaseAsync();
    await db.runAsync(
      'INSERT OR IGNORE INTO recipe_list_items (list_id, recipe_id, sort_order) VALUES (?, ?, 0)',
      [params.addToListId, newId]
    );
  }
  return newId;
}

async function applyRecipePayloadAsync(
  db: SQLiteDatabase,
  recipeId: number,
  payload: RecipeSavePayload
): Promise<void> {
  const now = isoNow();
  await db.runAsync('DELETE FROM cook_progress WHERE recipe_id = ?', [recipeId]);
  await db.runAsync('DELETE FROM recipe_tags WHERE recipe_id = ?', [recipeId]);
  await db.runAsync('DELETE FROM ingredients WHERE recipe_id = ?', [recipeId]);
  await db.runAsync('DELETE FROM ingredient_groups WHERE recipe_id = ?', [recipeId]);
  await db.runAsync('DELETE FROM steps WHERE recipe_id = ?', [recipeId]);
  await db.runAsync('DELETE FROM step_sections WHERE recipe_id = ?', [recipeId]);
  await db.runAsync(
    `UPDATE recipes SET
      title = ?, description = ?, source_url = ?, base_servings = ?,
      prep_time_min = ?, cook_time_min = ?, total_time_min = ?,
      category = ?, diet_vegetarian = ?, diet_vegan = ?, diet_keto = ?,
      is_favorite = ?, want_to_try = ?, notes = ?, image_uri = ?,
      updated_at = ?
    WHERE id = ?`,
    [
      payload.title.trim(),
      payload.description.trim() || null,
      payload.sourceUrl.trim() || null,
      payload.baseServings,
      payload.prepTimeMin,
      payload.cookTimeMin,
      payload.totalTimeMin,
      payload.category.trim() || null,
      payload.dietVegetarian ? 1 : 0,
      payload.dietVegan ? 1 : 0,
      payload.dietKeto ? 1 : 0,
      payload.isFavorite ? 1 : 0,
      payload.wantToTry ? 1 : 0,
      payload.notes.trim() || null,
      payload.imageUri.trim() || null,
      now,
      recipeId,
    ]
  );
  await insertNested(db, recipeId, payload);
  await linkTags(db, recipeId, payload.tagNames);
}

async function insertRecipeVersionSnapshotAsync(
  db: SQLiteDatabase,
  recipeId: number,
  note: string,
  snapshot: FullRecipe
): Promise<void> {
  const maxRow = await db.getFirstAsync<{ m: number | null }>(
    'SELECT MAX(version_number) as m FROM recipe_versions WHERE recipe_id = ?',
    [recipeId]
  );
  const v = (maxRow?.m ?? 0) + 1;
  await db.runAsync(
    'INSERT INTO recipe_versions (recipe_id, version_number, note, snapshot, created_at) VALUES (?, ?, ?, ?, ?)',
    [recipeId, v, note.trim() || null, JSON.stringify(snapshot), isoNow()]
  );
}

export async function updateRecipe(recipeId: number, payload: RecipeSavePayload): Promise<void> {
  const db = await ensureDatabaseAsync();
  const prevRow = await db.getFirstAsync<{ image_uri: string | null }>(
    'SELECT image_uri FROM recipes WHERE id = ?',
    [recipeId]
  );
  const prevUri = prevRow?.image_uri ?? null;
  const nextUri = payload.imageUri.trim() || null;
  await db.withTransactionAsync(async () => {
    await applyRecipePayloadAsync(db, recipeId, payload);
  });
  if (prevUri && prevUri !== nextUri) {
    await tryDeleteManagedCover(prevUri);
  }
}

/** Alleen `is_favorite` bijwerken (bijv. toggle op receptdetail). */
export async function setRecipeFavoriteFlag(recipeId: number, isFavorite: boolean): Promise<void> {
  const db = await ensureDatabaseAsync();
  await db.runAsync('UPDATE recipes SET is_favorite = ?, updated_at = ? WHERE id = ?', [
    isFavorite ? 1 : 0,
    isoNow(),
    recipeId,
  ]);
}

/** Snapshot vóór wijziging in `recipe_versions`, daarna `updateRecipe`-logica. */
export async function applyAiAdjustedRecipe(
  recipeId: number,
  payload: RecipeSavePayload,
  adjustmentNote: string
): Promise<void> {
  const db = await ensureDatabaseAsync();
  let previousImageUri: string | null = null;
  await db.withTransactionAsync(async () => {
    const current = await getFullRecipe(recipeId);
    if (!current) {
      throw new Error('Recept niet gevonden.');
    }
    previousImageUri = current.imageUri;
    await insertRecipeVersionSnapshotAsync(db, recipeId, adjustmentNote, current);
    await applyRecipePayloadAsync(db, recipeId, payload);
  });
  const nextUri = payload.imageUri.trim() || null;
  if (previousImageUri && previousImageUri !== nextUri) {
    await tryDeleteManagedCover(previousImageUri);
  }
}

export async function countRecipeVersions(recipeId: number): Promise<number> {
  const db = await ensureDatabaseAsync();
  const row = await db.getFirstAsync<{ c: number }>(
    'SELECT COUNT(*) as c FROM recipe_versions WHERE recipe_id = ?',
    [recipeId]
  );
  return row?.c ?? 0;
}

export type RecipeVersionSummary = {
  id: number;
  versionNumber: number;
  note: string | null;
  createdAt: string;
};

export async function listRecipeVersions(recipeId: number): Promise<RecipeVersionSummary[]> {
  const db = await ensureDatabaseAsync();
  const rows = await db.getAllAsync<{
    id: number;
    version_number: number;
    note: string | null;
    created_at: string;
  }>(
    `SELECT id, version_number, note, created_at
     FROM recipe_versions
     WHERE recipe_id = ?
     ORDER BY version_number DESC, id DESC`,
    [recipeId]
  );
  return rows.map((r) => ({
    id: r.id,
    versionNumber: r.version_number,
    note: r.note,
    createdAt: r.created_at,
  }));
}

function isLikelyFullRecipeSnapshot(x: unknown): x is FullRecipe {
  if (!x || typeof x !== 'object') return false;
  const r = x as Partial<FullRecipe>;
  if (typeof r.title !== 'string' || !r.title.trim()) return false;
  if (!Array.isArray(r.ingredientGroups)) return false;
  if (!Array.isArray(r.stepSections)) return false;
  if (!Array.isArray(r.tags)) return false;
  return true;
}

export async function restoreRecipeFromVersion(params: {
  recipeId: number;
  versionId: number;
}): Promise<void> {
  const db = await ensureDatabaseAsync();
  let previousImageUri: string | null = null;
  let nextImageUri: string | null = null;

  await db.withTransactionAsync(async () => {
    const current = await getFullRecipe(params.recipeId);
    if (!current) throw new Error('Recept niet gevonden.');
    previousImageUri = current.imageUri;

    const row = await db.getFirstAsync<{ snapshot: string }>(
      'SELECT snapshot FROM recipe_versions WHERE id = ? AND recipe_id = ?',
      [params.versionId, params.recipeId]
    );
    if (!row?.snapshot) throw new Error('Versie niet gevonden.');

    let parsed: unknown;
    try {
      parsed = JSON.parse(row.snapshot);
    } catch {
      throw new Error('Snapshot is geen geldige JSON.');
    }
    if (!isLikelyFullRecipeSnapshot(parsed)) throw new Error('Snapshot heeft niet de verwachte vorm.');

    // Always save current state before restoring.
    await insertRecipeVersionSnapshotAsync(db, params.recipeId, 'Vóór terugzetten', current);

    const payload = fullRecipeToPayload(parsed);
    nextImageUri = payload.imageUri.trim() || null;
    await applyRecipePayloadAsync(db, params.recipeId, payload);
  });

  if (previousImageUri && previousImageUri !== nextImageUri) {
    await tryDeleteManagedCover(previousImageUri);
  }
}

export async function deleteRecipe(recipeId: number): Promise<void> {
  const db = await ensureDatabaseAsync();
  const row = await db.getFirstAsync<{ image_uri: string | null }>(
    'SELECT image_uri FROM recipes WHERE id = ?',
    [recipeId]
  );
  await db.runAsync('DELETE FROM recipes WHERE id = ?', [recipeId]);
  await tryDeleteManagedCover(row?.image_uri ?? null);
}

export function fullRecipeToPayload(r: FullRecipe): RecipeSavePayload {
  return {
    title: r.title,
    description: r.description ?? '',
    sourceUrl: r.sourceUrl ?? '',
    baseServings: r.baseServings ?? 4,
    prepTimeMin: r.prepTimeMin,
    cookTimeMin: r.cookTimeMin,
    totalTimeMin: r.totalTimeMin,
    category: r.category ?? '',
    dietVegetarian: r.dietVegetarian,
    dietVegan: r.dietVegan,
    dietKeto: r.dietKeto,
    isFavorite: r.isFavorite,
    wantToTry: r.wantToTry,
    notes: r.notes ?? '',
    imageUri: r.imageUri ?? '',
    tagNames: [...r.tags],
    ingredientGroups: r.ingredientGroups.map((g) => ({
      title: g.title ?? '',
      ingredients: g.ingredients.map((i) => ({
        name: i.name,
        amount: i.amount,
        unit: i.unit,
      })),
    })),
    stepSections: r.stepSections.map((s) => ({
      title: s.title ?? '',
      steps: s.steps.map((st) => ({
        description: st.description,
        timerSeconds: st.timerSeconds,
      })),
    })),
  };
}

/** Removes any stored checklist state for this recipe (legacy rows from when progress was persisted). */
export async function clearCookProgress(recipeId: number): Promise<void> {
  const db = await ensureDatabaseAsync();
  await db.runAsync('DELETE FROM cook_progress WHERE recipe_id = ?', [recipeId]);
}
