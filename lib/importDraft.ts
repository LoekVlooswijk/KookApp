import type { RecipeSavePayload } from './types';

/** Tijdelijke opslag tussen import-scherm en nieuw-receptformulier (Strict Mode–veilig). */
const sessions = new Map<string, RecipeSavePayload>();

export function registerImportSession(payload: RecipeSavePayload): string {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  sessions.set(id, payload);
  return id;
}

export function getImportSession(id: string): RecipeSavePayload | null {
  return sessions.get(id) ?? null;
}

export function disposeImportSession(id: string): void {
  sessions.delete(id);
}
