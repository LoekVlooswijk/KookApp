import * as SQLite from 'expo-sqlite';

/** SQLite-bestandsnaam in de app-database-map (backup/restore gebruikt dezelfde naam). */
export const DB_NAME = 'kook.db';

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function ensureMetaTableAsync(db: SQLite.SQLiteDatabase) {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
  `);
}

async function ensureSchemaVersionRowAsync(db: SQLite.SQLiteDatabase) {
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM app_meta WHERE key = 'schema_version'"
  );
  if (!row) {
    await db.runAsync("INSERT INTO app_meta (key, value) VALUES ('schema_version', '0')");
  }
}

async function readSchemaVersionAsync(db: SQLite.SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM app_meta WHERE key = 'schema_version'"
  );
  return row ? Number.parseInt(row.value, 10) || 0 : 0;
}

async function writeSchemaVersionAsync(db: SQLite.SQLiteDatabase, version: number) {
  await db.runAsync('UPDATE app_meta SET value = ? WHERE key = ?', [
    String(version),
    'schema_version',
  ]);
}

/** Full schema from plan + cook_progress for kookweergave. */
async function migration1(db: SQLite.SQLiteDatabase) {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS recipes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      source_url TEXT,
      base_servings INTEGER,
      prep_time_min INTEGER,
      cook_time_min INTEGER,
      total_time_min INTEGER,
      category TEXT,
      is_favorite INTEGER NOT NULL DEFAULT 0,
      want_to_try INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      image_uri TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ingredient_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
      title TEXT,
      order_index INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ingredients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
      group_id INTEGER REFERENCES ingredient_groups(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      amount REAL,
      unit TEXT,
      order_index INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS step_sections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
      title TEXT,
      order_index INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
      section_id INTEGER REFERENCES step_sections(id) ON DELETE SET NULL,
      order_index INTEGER NOT NULL,
      description TEXT NOT NULL,
      timer_seconds INTEGER
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS recipe_tags (
      recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (recipe_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS recipe_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL,
      note TEXT,
      snapshot TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS techniques (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      related_recipe_ids TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS week_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
      servings INTEGER NOT NULL,
      cooks_for_days INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER
    );

    CREATE TABLE IF NOT EXISTS shopping_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id INTEGER REFERENCES week_plans(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      amount REAL,
      unit TEXT,
      is_checked INTEGER NOT NULL DEFAULT 0,
      category TEXT
    );

    CREATE TABLE IF NOT EXISTS cook_progress (
      recipe_id INTEGER PRIMARY KEY REFERENCES recipes(id) ON DELETE CASCADE,
      checked_ingredient_ids TEXT NOT NULL DEFAULT '[]',
      checked_step_ids TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_ingredients_recipe ON ingredients(recipe_id);
    CREATE INDEX IF NOT EXISTS idx_steps_recipe ON steps(recipe_id);
    CREATE INDEX IF NOT EXISTS idx_ingredient_groups_recipe ON ingredient_groups(recipe_id);
    CREATE INDEX IF NOT EXISTS idx_step_sections_recipe ON step_sections(recipe_id);
  `);
}

/** `veganistisch` → `vegan` in tags + recipe_tags (één canonieke tag). */
async function migration3(db: SQLite.SQLiteDatabase) {
  const vi = await db.getFirstAsync<{ id: number }>(
    "SELECT id FROM tags WHERE name = 'veganistisch' COLLATE NOCASE"
  );
  if (!vi) return;
  const ve = await db.getFirstAsync<{ id: number }>(
    "SELECT id FROM tags WHERE name = 'vegan' COLLATE NOCASE"
  );
  if (ve) {
    await db.runAsync(
      `INSERT OR IGNORE INTO recipe_tags (recipe_id, tag_id)
       SELECT rt.recipe_id, ? FROM recipe_tags rt WHERE rt.tag_id = ?`,
      [ve.id, vi.id]
    );
    await db.runAsync('DELETE FROM recipe_tags WHERE tag_id = ?', [vi.id]);
    await db.runAsync('DELETE FROM tags WHERE id = ?', [vi.id]);
  } else {
    await db.runAsync("UPDATE tags SET name = 'vegan' WHERE id = ?", [vi.id]);
  }
}

async function migration2(db: SQLite.SQLiteDatabase) {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS recipe_lists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS recipe_list_items (
      list_id INTEGER NOT NULL REFERENCES recipe_lists(id) ON DELETE CASCADE,
      recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (list_id, recipe_id)
    );

    CREATE INDEX IF NOT EXISTS idx_recipe_list_items_list ON recipe_list_items(list_id);
    CREATE INDEX IF NOT EXISTS idx_recipe_list_items_recipe ON recipe_list_items(recipe_id);
  `);
}

/** Dieetvelden op recipes + backfill vanuit tags. */
async function migration4(db: SQLite.SQLiteDatabase) {
  await db.execAsync(`
    ALTER TABLE recipes ADD COLUMN diet_vegetarian INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE recipes ADD COLUMN diet_vegan INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE recipes ADD COLUMN diet_keto INTEGER NOT NULL DEFAULT 0;
  `);

  // Backfill flags from existing tags (case-insensitive matching).
  await db.runAsync(
    `UPDATE recipes
     SET diet_vegan = 1, diet_vegetarian = 1
     WHERE id IN (
       SELECT rt.recipe_id
       FROM recipe_tags rt
       JOIN tags t ON t.id = rt.tag_id
       WHERE t.name = 'vegan' COLLATE NOCASE
     )`
  );
  await db.runAsync(
    `UPDATE recipes
     SET diet_vegetarian = 1
     WHERE id IN (
       SELECT rt.recipe_id
       FROM recipe_tags rt
       JOIN tags t ON t.id = rt.tag_id
       WHERE t.name = 'vegetarisch' COLLATE NOCASE
     )`
  );
  await db.runAsync(
    `UPDATE recipes
     SET diet_keto = 1
     WHERE id IN (
       SELECT rt.recipe_id
       FROM recipe_tags rt
       JOIN tags t ON t.id = rt.tag_id
       WHERE t.name = 'keto' COLLATE NOCASE
     )`
  );

  // Remove diet tags from tag relations (tags remain only if used elsewhere).
  await db.runAsync(
    `DELETE FROM recipe_tags
     WHERE tag_id IN (
       SELECT id FROM tags WHERE name IN ('vegetarisch','vegan','keto') COLLATE NOCASE
     )`
  );
  await db.runAsync(
    `DELETE FROM tags
     WHERE name IN ('vegetarisch','vegan','keto') COLLATE NOCASE
       AND id NOT IN (SELECT DISTINCT tag_id FROM recipe_tags)`
  );
}

/** Beheerbare categorie-lijst (los van tags) + seed defaults. */
async function migration5(db: SQLite.SQLiteDatabase) {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS managed_categories (
      name TEXT PRIMARY KEY NOT NULL
    );
  `);

  // Seed default categories (canonical, lowercase).
  const defaults = ['hoofdgerecht', 'voorgerecht', 'toetje', 'bijgerecht', 'snack'];
  for (const c of defaults) {
    await db.runAsync('INSERT OR IGNORE INTO managed_categories (name) VALUES (?)', [c]);
  }
}

/** Markeer weekplanner-dagen als "restjes" van een eerdere kookdag. */
async function migration6(db: SQLite.SQLiteDatabase) {
  await db.execAsync(`
    ALTER TABLE week_plans ADD COLUMN leftover_of_date TEXT;
  `);
}

const MIGRATIONS: Record<number, (db: SQLite.SQLiteDatabase) => Promise<void>> = {
  1: migration1,
  2: migration2,
  3: migration3,
  4: migration4,
  5: migration5,
  6: migration6,
};

async function runPendingMigrationsAsync(db: SQLite.SQLiteDatabase) {
  let version = await readSchemaVersionAsync(db);
  for (let i = 0; i < 64; i++) {
    const next = version + 1;
    const run = MIGRATIONS[next];
    if (!run) break;
    await db.withTransactionAsync(async () => {
      await run(db);
      await writeSchemaVersionAsync(db, next);
    });
    version = next;
  }
}

async function openAndMigrateAsync(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DB_NAME);
  await db.execAsync('PRAGMA foreign_keys = ON;');
  await ensureMetaTableAsync(db);
  await ensureSchemaVersionRowAsync(db);
  await runPendingMigrationsAsync(db);
  return db;
}

/**
 * Single shared DB instance (async API everywhere — no SharedArrayBuffer on web).
 */
export function ensureDatabaseAsync(): Promise<SQLite.SQLiteDatabase> {
  if (!databasePromise) {
    databasePromise = openAndMigrateAsync();
  }
  return databasePromise;
}

/** Sluit de gedeelde verbinding zodat het bestand veilig te vervangen of te verwijderen is. */
export async function closeAndResetDatabaseConnectionAsync(): Promise<void> {
  if (!databasePromise) return;
  try {
    const db = await databasePromise;
    await db.closeAsync();
  } catch {
    /* sluitpoging na corrupte state */
  }
  databasePromise = null;
}

export async function getSchemaVersion(): Promise<number> {
  const db = await ensureDatabaseAsync();
  return readSchemaVersionAsync(db);
}
