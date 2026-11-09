import {
  MAX_MIGRATION_VERSION,
  prepareDatabaseSchemaAsync,
  readSchemaVersionAsync,
} from '../dbMigrations';
import { openSqlJsMigrationDb } from './sqlJsMigrationDb';

describe('dbMigrations (sql.js)', () => {
  it('migrates an empty database to the latest schema version', async () => {
    const { migrationDb } = await openSqlJsMigrationDb();
    await prepareDatabaseSchemaAsync(migrationDb);
    const v = await readSchemaVersionAsync(migrationDb);
    expect(v).toBe(MAX_MIGRATION_VERSION);
  });

  it('is idempotent when prepare runs again', async () => {
    const { migrationDb } = await openSqlJsMigrationDb();
    await prepareDatabaseSchemaAsync(migrationDb);
    const v1 = await readSchemaVersionAsync(migrationDb);
    await prepareDatabaseSchemaAsync(migrationDb);
    const v2 = await readSchemaVersionAsync(migrationDb);
    expect(v2).toBe(v1);
    expect(v2).toBe(MAX_MIGRATION_VERSION);
  });

  it('adds the Kooktijden sheet next to Technieken on the kennis grid', async () => {
    const { migrationDb } = await openSqlJsMigrationDb();
    await prepareDatabaseSchemaAsync(migrationDb);
    const kooktijden = await migrationDb.getFirstAsync<{
      is_pinned: number;
      sort_order: number;
      icon: string | null;
      accent: string | null;
      is_wide: number;
    }>(
      `SELECT is_pinned, sort_order, icon, accent, is_wide FROM knowledge_tags WHERE name = 'Kooktijden'`
    );
    expect(kooktijden).toEqual({
      is_pinned: 1,
      sort_order: 6,
      icon: 'clock',
      accent: 'lavender',
      is_wide: 0,
    });

    const technieken = await migrationDb.getFirstAsync<{ is_wide: number; sort_order: number }>(
      `SELECT is_wide, sort_order FROM knowledge_tags WHERE name = 'Technieken'`
    );
    expect(technieken).toEqual({ is_wide: 0, sort_order: 5 });
  });

  it('adds week_plan_labels for free-text day labels (migratie 14)', async () => {
    const { migrationDb } = await openSqlJsMigrationDb();
    await prepareDatabaseSchemaAsync(migrationDb);

    // één label per datum, upsert-vriendelijk
    await migrationDb.runAsync(`INSERT INTO week_plan_labels (date, label) VALUES (?, ?)`, [
      '2024-01-02',
      'Uit eten',
    ]);
    await migrationDb.runAsync(`UPDATE week_plan_labels SET label = ? WHERE date = ?`, [
      'Eten bij ouders',
      '2024-01-02',
    ]);
    const label = await migrationDb.getFirstAsync<{ label: string }>(
      `SELECT label FROM week_plan_labels WHERE date = '2024-01-02'`
    );
    expect(label?.label).toBe('Eten bij ouders');

    // week_plans blijft ongewijzigd naast de labels-tabel
    await migrationDb.runAsync(
      `INSERT INTO recipes (title, created_at, updated_at) VALUES ('Testrecept', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')`
    );
    await migrationDb.runAsync(
      `INSERT INTO week_plans (date, recipe_id, servings, cooks_for_days) VALUES ('2024-01-03', 1, 2, 1)`
    );
    await migrationDb.runAsync(`DELETE FROM week_plan_labels WHERE date = '2024-01-03'`);
    const plan = await migrationDb.getFirstAsync<{ recipe_id: number }>(
      `SELECT recipe_id FROM week_plans WHERE date = '2024-01-03'`
    );
    expect(plan?.recipe_id).toBe(1);
    expect(MAX_MIGRATION_VERSION).toBeGreaterThanOrEqual(14);
  });
});
