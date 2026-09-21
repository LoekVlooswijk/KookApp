import * as SQLite from 'expo-sqlite';

import { prepareDatabaseSchemaAsync, readSchemaVersionAsync } from './dbMigrations';

/** SQLite-bestandsnaam in de app-database-map (backup/restore gebruikt dezelfde naam). */
export const DB_NAME = 'kook.db';

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function openAndMigrateAsync(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DB_NAME);
  await prepareDatabaseSchemaAsync(db);
  return db;
}

/**
 * Single shared DB instance (async API everywhere — no SharedArrayBuffer on web).
 * Clears the cached promise on failure so the next call can retry open/migrate.
 */
export function ensureDatabaseAsync(): Promise<SQLite.SQLiteDatabase> {
  if (!databasePromise) {
    databasePromise = (async () => {
      try {
        return await openAndMigrateAsync();
      } catch (e) {
        databasePromise = null;
        throw e;
      }
    })();
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
