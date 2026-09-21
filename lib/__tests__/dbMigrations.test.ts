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
});
