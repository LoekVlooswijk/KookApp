import { deleteAppMeta, getAppMeta, setAppMeta } from './appMeta';

const META_STAPLES_EXCLUDE_V1 = 'shopping_staples_exclude_v1';

let staplesCache: string[] = [];

function normalizeLine(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeList(lines: unknown): string[] {
  const arr = Array.isArray(lines) ? lines : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of arr) {
    const t = normalizeLine(typeof x === 'string' ? x : '');
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

export function getShoppingStaplesExcludeList(): string[] {
  return staplesCache;
}

export async function hydrateShoppingStaplesPrefsFromDb(): Promise<void> {
  const raw = await getAppMeta(META_STAPLES_EXCLUDE_V1);
  if (!raw) {
    staplesCache = ['zout', 'peper', 'olie', 'water'];
    return;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    const list = normalizeList(parsed);
    staplesCache = list.length > 0 ? list : ['zout', 'peper', 'olie', 'water'];
  } catch {
    staplesCache = ['zout', 'peper', 'olie', 'water'];
  }
}

export async function setShoppingStaplesExcludeList(lines: string[]): Promise<void> {
  const list = normalizeList(lines);
  staplesCache = list;
  if (list.length === 0) {
    await deleteAppMeta(META_STAPLES_EXCLUDE_V1);
    return;
  }
  await setAppMeta(META_STAPLES_EXCLUDE_V1, JSON.stringify(list));
}

/** Append one pantry line (e.g. from long-press on shopping list). Dedupes via normalizeList. */
export async function appendShoppingStapleExcludeLine(raw: string): Promise<void> {
  await hydrateShoppingStaplesPrefsFromDb();
  await setShoppingStaplesExcludeList([...staplesCache, raw]);
}

export function staplesTextToList(text: string): string[] {
  const lines = String(text ?? '')
    .split(/\r?\n/g)
    .map((x) => normalizeLine(x))
    .filter(Boolean);
  return normalizeList(lines);
}

export function staplesListToText(lines: string[]): string {
  return (Array.isArray(lines) ? lines : []).map((x) => x.trim()).filter(Boolean).join('\n').trim();
}

