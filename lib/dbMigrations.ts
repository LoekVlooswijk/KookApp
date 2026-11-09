/**
 * SQLite schema migrations — shared between app (`expo-sqlite`) and Node tests (`sql.js`).
 * Keep foreign keys and transactions aligned with `lib/db.ts` open path.
 */

import type * as SQLite from 'expo-sqlite';

/** Subset of `expo-sqlite` DB API used here (sql.js tests implement the same shape). */
export type MigrationDb = Pick<
  SQLite.SQLiteDatabase,
  'execAsync' | 'runAsync' | 'getFirstAsync' | 'getAllAsync' | 'withTransactionAsync'
>;

async function ensureMetaTableAsync(db: MigrationDb) {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
  `);
}

async function ensureSchemaVersionRowAsync(db: MigrationDb) {
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM app_meta WHERE key = 'schema_version'"
  );
  if (!row) {
    await db.runAsync("INSERT INTO app_meta (key, value) VALUES ('schema_version', '0')");
  }
}

export async function readSchemaVersionAsync(db: MigrationDb): Promise<number> {
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM app_meta WHERE key = 'schema_version'"
  );
  return row ? Number.parseInt(row.value, 10) || 0 : 0;
}

async function tableExistsAsync(db: MigrationDb, table: string): Promise<boolean> {
  const row = await db.getFirstAsync<{ n: number }>(
    "SELECT 1 AS n FROM sqlite_master WHERE type='table' AND name=? LIMIT 1",
    [table]
  );
  return !!row;
}

async function columnExistsAsync(db: MigrationDb, table: string, column: string): Promise<boolean> {
  const rows = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  return rows.some((r) => r.name === column);
}

/**
 * Lowest schema_version consistent with actual tables/columns (guards corrupt/low meta rows).
 */
async function inferSchemaVersionFloorAsync(db: MigrationDb): Promise<number> {
  if (!(await tableExistsAsync(db, 'recipes'))) return 0;
  if (await columnExistsAsync(db, 'recipes', 'last_opened_at')) return 11;
  if (await columnExistsAsync(db, 'knowledge_tags', 'is_wide')) return 8;
  if (await tableExistsAsync(db, 'knowledge_entries')) return 7;
  if (await columnExistsAsync(db, 'week_plans', 'leftover_of_date')) return 6;
  if (await tableExistsAsync(db, 'managed_categories')) return 5;
  if (await columnExistsAsync(db, 'recipes', 'diet_vegetarian')) return 4;
  if (await tableExistsAsync(db, 'recipe_lists')) return 2;
  return 1;
}

async function reconcileSchemaVersionWithActualSchemaAsync(db: MigrationDb, maxVersion: number) {
  const parsed = await readSchemaVersionAsync(db);
  const floor = await inferSchemaVersionFloorAsync(db);
  let effective = Math.max(parsed, floor);
  if (effective > maxVersion) effective = maxVersion;
  if (effective !== parsed) {
    await writeSchemaVersionAsync(db, effective);
  }
}

async function writeSchemaVersionAsync(db: MigrationDb, version: number) {
  await db.runAsync('UPDATE app_meta SET value = ? WHERE key = ?', [
    String(version),
    'schema_version',
  ]);
}

/** Full schema from plan + cook_progress for kookweergave. */
async function migration1(db: MigrationDb) {
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
async function migration3(db: MigrationDb) {
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

async function migration2(db: MigrationDb) {
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
async function migration4(db: MigrationDb) {
  if (!(await columnExistsAsync(db, 'recipes', 'diet_vegetarian'))) {
    await db.execAsync(`
      ALTER TABLE recipes ADD COLUMN diet_vegetarian INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE recipes ADD COLUMN diet_vegan INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE recipes ADD COLUMN diet_keto INTEGER NOT NULL DEFAULT 0;
    `);
  }

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
async function migration5(db: MigrationDb) {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS managed_categories (
      name TEXT PRIMARY KEY NOT NULL
    );
  `);

  const defaults = ['hoofdgerecht', 'voorgerecht', 'toetje', 'bijgerecht', 'snack'];
  for (const c of defaults) {
    await db.runAsync('INSERT OR IGNORE INTO managed_categories (name) VALUES (?)', [c]);
  }
}

/** Markeer weekplanner-dagen als "restjes" van een eerdere kookdag. */
async function migration6(db: MigrationDb) {
  if (!(await columnExistsAsync(db, 'week_plans', 'leftover_of_date'))) {
    await db.execAsync(`
      ALTER TABLE week_plans ADD COLUMN leftover_of_date TEXT;
    `);
  }
}

/** Kennisbank (knowledge entries + tags) */
async function migration7(db: MigrationDb) {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS knowledge_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT,
      ratio TEXT,
      source_recipe_id INTEGER REFERENCES recipes(id),
      is_pinned INTEGER NOT NULL DEFAULT 0,
      pinned_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS knowledge_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      is_pinned INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER,
      icon TEXT,
      accent TEXT
    );

    CREATE TABLE IF NOT EXISTS knowledge_entry_tags (
      entry_id INTEGER NOT NULL REFERENCES knowledge_entries(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES knowledge_tags(id) ON DELETE CASCADE,
      PRIMARY KEY (entry_id, tag_id)
    );

    CREATE INDEX IF NOT EXISTS idx_knowledge_entry_tags_entry ON knowledge_entry_tags(entry_id);
    CREATE INDEX IF NOT EXISTS idx_knowledge_entry_tags_tag ON knowledge_entry_tags(tag_id);
    CREATE INDEX IF NOT EXISTS idx_knowledge_entries_updated ON knowledge_entries(updated_at);
    CREATE INDEX IF NOT EXISTS idx_knowledge_entries_pinned ON knowledge_entries(is_pinned, pinned_at);
  `);

  const seed = [
    { name: 'Kruiden per keuken', sortOrder: 1, icon: 'herb', accent: 'sage' },
    { name: "Ratio's", sortOrder: 2, icon: 'scale', accent: 'ochre' },
    { name: 'Temperaturen', sortOrder: 3, icon: 'thermometer', accent: 'rust' },
    { name: 'Substituties', sortOrder: 4, icon: 'swap', accent: 'sky' },
  ] as const;
  for (const s of seed) {
    await db.runAsync(
      `INSERT OR IGNORE INTO knowledge_tags (name, is_pinned, sort_order, icon, accent)
       VALUES (?, 1, ?, ?, ?)`,
      [s.name, s.sortOrder, s.icon, s.accent]
    );
    await db.runAsync(
      `UPDATE knowledge_tags
       SET is_pinned = 1, sort_order = ?, icon = ?, accent = ?
       WHERE name = ?`,
      [s.sortOrder, s.icon, s.accent, s.name]
    );
  }
}

/** Extra kennisbank-sheet: Technieken (+ wide tile) */
async function migration8(db: MigrationDb) {
  if (!(await columnExistsAsync(db, 'knowledge_tags', 'is_wide'))) {
    await db.execAsync(`
      ALTER TABLE knowledge_tags ADD COLUMN is_wide INTEGER NOT NULL DEFAULT 0;
    `);
  }

  await db.runAsync(
    `INSERT OR IGNORE INTO knowledge_tags (name, is_pinned, sort_order, icon, accent, is_wide)
     VALUES (?, 1, 5, 'flame', 'clay', 1)`,
    ['Technieken']
  );
  await db.runAsync(
    `UPDATE knowledge_tags
     SET is_pinned = 1, sort_order = 5, icon = 'flame', accent = 'clay', is_wide = 1
     WHERE name = ?`,
    ['Technieken']
  );
}

/** Bio-score kleur (rood/oranje/groen) op recipes. */
async function migration9(db: MigrationDb) {
  if (!(await columnExistsAsync(db, 'recipes', 'bio_score_color'))) {
    await db.execAsync(`
      ALTER TABLE recipes ADD COLUMN bio_score_color TEXT;
    `);
  }
}

/** Bio-score details: compacte (groente/fruit) breakdown + timestamp. */
async function migration10(db: MigrationDb) {
  if (!(await columnExistsAsync(db, 'recipes', 'bio_score_updated_at'))) {
    await db.execAsync(`
      ALTER TABLE recipes ADD COLUMN bio_score_updated_at TEXT;
    `);
  }
  if (!(await columnExistsAsync(db, 'recipes', 'bio_score_items_json'))) {
    await db.execAsync(`
      ALTER TABLE recipes ADD COLUMN bio_score_items_json TEXT;
    `);
  }
}

/** Track last opened timestamp for recipes to show on homescreen. */
async function migration11(db: MigrationDb) {
  if (!(await columnExistsAsync(db, 'recipes', 'last_opened_at'))) {
    await db.execAsync(`
      ALTER TABLE recipes ADD COLUMN last_opened_at TEXT;
    `);
  }
  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_recipes_last_opened ON recipes(last_opened_at);
  `);
}

/** Chat history for AI conversations */
async function migration12(db: MigrationDb) {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipe_id INTEGER NOT NULL,
      servings INTEGER NOT NULL,
      session_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_recipe ON chat_sessions(recipe_id);
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_key ON chat_sessions(session_key);
  `);
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);
  `);
}

/** Kennisbank-sheet: Kooktijden. Technieken wordt half-breed zodat rij 3 twee tegels heeft. */
async function migration13(db: MigrationDb) {
  await db.runAsync(
    `UPDATE knowledge_tags
     SET is_wide = 0
     WHERE name = ?`,
    ['Technieken']
  );
  await db.runAsync(
    `INSERT OR IGNORE INTO knowledge_tags (name, is_pinned, sort_order, icon, accent, is_wide)
     VALUES (?, 1, 6, 'clock', 'lavender', 0)`,
    ['Kooktijden']
  );
  await db.runAsync(
    `UPDATE knowledge_tags
     SET is_pinned = 1, sort_order = 6, icon = 'clock', accent = 'lavender', is_wide = 0
     WHERE name = ?`,
    ['Kooktijden']
  );
}

const MIGRATIONS: Record<number, (db: MigrationDb) => Promise<void>> = {
  1: migration1,
  2: migration2,
  3: migration3,
  4: migration4,
  5: migration5,
  6: migration6,
  7: migration7,
  8: migration8,
  9: migration9,
  10: migration10,
  11: migration11,
  12: migration12,
  13: migration13,
};

export const MAX_MIGRATION_VERSION = Math.max(
  ...Object.keys(MIGRATIONS).map((k) => Number.parseInt(k, 10))
);

async function runPendingMigrationsAsync(db: MigrationDb) {
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

/** PRAGMA, meta, reconcile stored version with actual schema, run pending migrations. */
export async function prepareDatabaseSchemaAsync(db: MigrationDb): Promise<void> {
  await db.execAsync('PRAGMA foreign_keys = ON;');
  await ensureMetaTableAsync(db);
  await ensureSchemaVersionRowAsync(db);
  await reconcileSchemaVersionWithActualSchemaAsync(db, MAX_MIGRATION_VERSION);
  await runPendingMigrationsAsync(db);
}
