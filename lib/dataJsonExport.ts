import { File as FsFile, Paths } from 'expo-file-system';
import * as SQLite from 'expo-sqlite';

import { ensureDatabaseAsync } from './db';

function isoStampForFilename(): string {
  return new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
}

function assertSafeIdentifier(name: string): string {
  const n = String(name ?? '').trim();
  if (!/^[a-zA-Z0-9_]+$/.test(n)) {
    throw new Error(`Onveilige tabelnaam: ${name}`);
  }
  return n;
}

async function listUserTables(db: SQLite.SQLiteDatabase): Promise<string[]> {
  const rows = await db.getAllAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC"
  );
  return rows.map((r) => r.name).filter(Boolean);
}

export type KookJsonExport = {
  exported_at: string;
  tables: Record<string, unknown[]>;
};

/** Exporteert alle app-tabellen (SQLite) naar één JSON-bestand in Documenten. */
export async function exportAllDataAsJsonFileAsync(): Promise<FsFile> {
  const db = await ensureDatabaseAsync();
  const tableNames = await listUserTables(db);

  const tables: Record<string, unknown[]> = {};
  for (const rawName of tableNames) {
    const name = assertSafeIdentifier(rawName);
    const rows = await db.getAllAsync<unknown>(`SELECT * FROM "${name}"`);
    tables[name] = Array.isArray(rows) ? rows : [];
  }

  const payload: KookJsonExport = {
    exported_at: new Date().toISOString(),
    tables,
  };

  const json = JSON.stringify(payload, null, 2);
  const bytes = new TextEncoder().encode(json);

  const f = new FsFile(Paths.document, `kook-export-${isoStampForFilename()}.json`);
  if (f.exists) {
    await f.delete();
  }
  await f.create();
  await f.write(bytes);
  return f;
}
