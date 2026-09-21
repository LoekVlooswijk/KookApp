import { Directory, File as FsFile, Paths } from 'expo-file-system';
import * as SQLite from 'expo-sqlite';
import { Platform, Share } from 'react-native';

import { closeAndResetDatabaseConnectionAsync, DB_NAME, ensureDatabaseAsync } from './db';

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
  const f = new FsFile(Paths.document, `kook-backup-${stamp}.db`);
  if (f.exists) {
    f.delete();
  }
  f.create();
  f.write(raw);
  return f;
}

/** Deelt een lokaal bestand via het systeem (`Share` i.p.v. expo-sharing i.v.m. Metro-bundling op Android). */
export async function shareLocalFileAsync(uri: string): Promise<void> {
  if (Platform.OS === 'web') {
    throw new Error('Delen op web wordt niet ondersteund.');
  }
  try {
    await Share.share({ url: uri, title: 'Kookapp-backup' });
  } catch (e) {
    throw e instanceof Error ? e : new Error('Delen mislukt.');
  }
}

async function restoreFreshDatabaseFromBytes(bytes: Uint8Array): Promise<void> {
  await closeAndResetDatabaseConnectionAsync();
  try {
    try {
      await SQLite.deleteDatabaseAsync(DB_NAME);
    } catch {
      /* bestond mogelijk niet */
    }
    const root = SQLite.defaultDatabaseDirectory;
    if (typeof root !== 'string' || !root.length) {
      throw new Error('Database-map niet beschikbaar.');
    }
    const target = new FsFile(new Directory(root), DB_NAME);
    if (target.exists) {
      target.delete();
    }
    target.create();
    target.write(bytes);
  } catch (e) {
    try {
      await SQLite.deleteDatabaseAsync(DB_NAME);
    } catch {
      /* noop */
    }
    await ensureDatabaseAsync();
    throw e instanceof Error ? e : new Error('Importeren mislukt.');
  }
  const db = await ensureDatabaseAsync();
  try {
    await assertKookSchemaPresent(db);
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
  const picked = await FsFile.pickFileAsync();
  const file = Array.isArray(picked) ? picked[0] : picked;
  if (!file) {
    throw new Error('Geen bestand gekozen.');
  }
  const bytes = await file.bytes();
  const buf = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (!isLikelySqliteDatabase(buf)) {
    throw new Error('Geen geldig SQLite-databasebestand.');
  }
  await restoreFreshDatabaseFromBytes(buf);
}

/** Verwijdert de volledige lokale database; bij volgende open worden tabellen opnieuw aangemaakt. */
export async function wipeAllLocalDatabaseDataAsync(): Promise<void> {
  await closeAndResetDatabaseConnectionAsync();
  await SQLite.deleteDatabaseAsync(DB_NAME);
  await ensureDatabaseAsync();
}
