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
});
