import { ensureDatabaseAsync } from './db';

/** Key/value in `app_meta` (niet voor geheimen). */
export async function getAppMeta(key: string): Promise<string | null> {
  const db = await ensureDatabaseAsync();
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_meta WHERE key = ?',
    [key]
  );
  return row?.value ?? null;
}

export async function setAppMeta(key: string, value: string): Promise<void> {
  const db = await ensureDatabaseAsync();
  await db.runAsync('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)', [key, value]);
}

export async function deleteAppMeta(key: string): Promise<void> {
  const db = await ensureDatabaseAsync();
  await db.runAsync('DELETE FROM app_meta WHERE key = ?', [key]);
}
