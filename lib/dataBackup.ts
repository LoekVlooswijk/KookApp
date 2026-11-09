import { File as FsFile, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';

import { closeAndResetDatabaseConnectionAsync, DB_NAME, ensureDatabaseAsync } from './db';
import { prepareDatabaseSchemaAsync } from './dbMigrations';

const SQLITE_MAGIC = new Uint8Array([
  0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, 0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00,
]);

function isLikelySqliteDatabase(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 512) return false;
  for (let i = 0; i < SQLITE_MAGIC.length; i++) {
    if (bytes[i] !== SQLITE_MAGIC[i]) return false;
  }
  return true;
}

async function assertKookSchemaPresent(db: SQLite.SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ n: number }>(
    "SELECT 1 AS n FROM sqlite_master WHERE type='table' AND name='recipes' LIMIT 1"
  );
  if (!row) {
    throw new Error('Dit bestand heeft niet de verwachte Kookapp-tabellen.');
  }
}

/** Schrijft een volledige kopie van de actieve database naar een .db-bestand in Documenten. */
export async function exportSerializedBackupFileAsync(): Promise<FsFile> {
  const db = await ensureDatabaseAsync();
  const raw = await db.serializeAsync();
  const stamp = new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');

  // Use Paths.document which is a Directory instance
  const f = new FsFile(Paths.document, `kook-backup-${stamp}.db`);
  if (f.exists) {
    await f.delete();
  }
  await f.create();
  await f.write(raw);
  return f;
}

/** Shares a local file using expo-sharing. Returns the file path for user reference. */
export async function shareLocalFileAsync(
  uri: string,
  options?: { mimeType?: string; dialogTitle?: string }
): Promise<string> {
  if (Platform.OS === 'web') {
    throw new Error('Delen op web wordt niet ondersteund.');
  }
  try {
    // expo-sharing handles content URIs automatically on Android
    await Sharing.shareAsync(uri, {
      mimeType: options?.mimeType,
      dialogTitle: options?.dialogTitle ?? 'Kookapp-bestand',
      UTI: options?.mimeType, // iOS uniform type identifier
    });
    return uri;
  } catch (e) {
    // If sharing fails, return the URI so caller can show it to user
    if (e instanceof Error && e.message.includes('no activity')) {
      // No app can handle this file type - return path for manual sharing
      return uri;
    }
    throw e instanceof Error ? e : new Error('Delen mislukt.');
  }
}

async function restoreFreshDatabaseFromBytes(bytes: Uint8Array): Promise<void> {
  await closeAndResetDatabaseConnectionAsync();
  try {
    // First, validate the backup bytes BEFORE deleting existing data
    if (!isLikelySqliteDatabase(bytes)) {
      throw new Error('Geen geldig SQLite-databasebestand.');
    }

    // Get the path where SQLite stores the database by opening it temporarily
    const tempDb = await SQLite.openDatabaseAsync(DB_NAME);
    const dbPath = tempDb.databasePath;
    await tempDb.closeAsync();

    // Delete existing database file
    try {
      await SQLite.deleteDatabaseAsync(DB_NAME);
    } catch {
      /* bestond mogelijk niet */
    }

    // Create the target file using the actual database path
    // We need to create a File object from the path
    const dbFile = new FsFile(dbPath);
    await dbFile.write(bytes);

    // Verify the file was written
    if (!dbFile.exists || dbFile.size !== bytes.length) {
      throw new Error(
        `Database file write failed: expected ${bytes.length} bytes, got ${dbFile.size ?? 0}`
      );
    }

    // Now open the database and run migrations
    const db = await SQLite.openDatabaseAsync(DB_NAME);
    await prepareDatabaseSchemaAsync(db);

    // Close it
    await db.closeAsync();

    // Reset the connection cache
    await closeAndResetDatabaseConnectionAsync();
  } catch (e) {
    try {
      await SQLite.deleteDatabaseAsync(DB_NAME);
    } catch {
      /* noop */
    }
    await ensureDatabaseAsync();
    throw e instanceof Error ? e : new Error('Importeren mislukt.');
  }

  // Verify the database
  const db = await ensureDatabaseAsync();
  try {
    await assertKookSchemaPresent(db);

    // Check for data
    const recipeCount = await db.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) as count FROM recipes'
    );
    if (recipeCount && recipeCount.count === 0) {
      const listCount = await db.getFirstAsync<{ count: number }>(
        'SELECT COUNT(*) as count FROM shopping_items'
      );
      const planCount = await db.getFirstAsync<{ count: number }>(
        'SELECT COUNT(*) as count FROM week_plans'
      );
      if ((listCount?.count ?? 0) === 0 && (planCount?.count ?? 0) === 0) {
        throw new Error(
          `Geïmporteerde database is leeg. Aantal: recipes=${recipeCount.count ?? 0}, shopping_items=${listCount?.count ?? 0}, week_plans=${planCount?.count ?? 0}. Controleer of het backup-bestand geldige data bevat.`
        );
      }
    }
  } catch (e) {
    await closeAndResetDatabaseConnectionAsync();
    try {
      await SQLite.deleteDatabaseAsync(DB_NAME);
    } catch {
      /* noop */
    }
    await ensureDatabaseAsync();
    throw e instanceof Error ? e : new Error('Ongeldige backup.');
  }
}

/** Vervangt de lokale database door een gekozen SQLite-bestand (bijv. eerdere export). */
export async function pickAndRestoreDatabaseBackupAsync(): Promise<void> {
  const result = await FsFile.pickFileAsync();
  // pickFileAsync returns { result: File, canceled: false } or { canceled: true }
  if (result.canceled || !result.result) {
    throw new Error('Geen bestand gekozen.');
  }
  const file = result.result;

  // Use the new File API properties directly
  if (!file.exists) {
    throw new Error('Het geselecteerde bestand bestaat niet meer.');
  }

  // Use bytes() method to read the file content
  const fileBytes = await file.bytes();

  // Verify we read the file
  if (file.size && fileBytes.length !== file.size) {
    throw new Error(`File size mismatch: expected ${file.size}, got ${fileBytes.length}`);
  }

  if (!isLikelySqliteDatabase(fileBytes)) {
    throw new Error('Geen geldig SQLite-databasebestand.');
  }
  await restoreFreshDatabaseFromBytes(fileBytes);
}

/** Verwijdert de volledige lokale database; bij volgende open worden tabellen opnieuw aangemaakt. */
export async function wipeAllLocalDatabaseDataAsync(): Promise<void> {
  await closeAndResetDatabaseConnectionAsync();
  await SQLite.deleteDatabaseAsync(DB_NAME);
  await ensureDatabaseAsync();
}
