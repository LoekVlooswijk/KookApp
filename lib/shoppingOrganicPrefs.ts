import { deleteAppMeta, getAppMeta, setAppMeta } from './appMeta';

const META_ORGANIC_ALWAYS_V1 = 'shopping_organic_always_v1';

const DEFAULT_ORGANIC_ALWAYS_V1 = ['paprika', 'spinazie', 'sperziebonen', 'rozijnen'] as const;

let organicCache: string[] = [];

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

export function getShoppingOrganicAlwaysList(): string[] {
  return organicCache;
}

export async function hydrateShoppingOrganicPrefsFromDb(): Promise<void> {
  const raw = await getAppMeta(META_ORGANIC_ALWAYS_V1);
  if (!raw) {
    organicCache = [...DEFAULT_ORGANIC_ALWAYS_V1];
    return;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    const list = normalizeList(parsed);
    organicCache = list;
  } catch {
    organicCache = [...DEFAULT_ORGANIC_ALWAYS_V1];
  }
}

export async function setShoppingOrganicAlwaysList(lines: string[]): Promise<void> {
  const list = normalizeList(lines);
  organicCache = list;
  if (list.length === 0) {
    await deleteAppMeta(META_ORGANIC_ALWAYS_V1);
    return;
  }
  await setAppMeta(META_ORGANIC_ALWAYS_V1, JSON.stringify(list));
}

export function organicTextToList(text: string): string[] {
  const lines = String(text ?? '')
    .split(/\r?\n/g)
    .map((x) => normalizeLine(x))
    .filter(Boolean);
  return normalizeList(lines);
}

export function organicListToText(lines: string[]): string {
  return (Array.isArray(lines) ? lines : [])
    .map((x) => x.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Match strategy:
 * - exact match
 * - whole-word match (handles "verse spinazie", "spinazie (diepvries)")
 * - substring match for longer tokens (handles "spinazieblaadjes")
 */
export function isAlwaysOrganicItemName(itemName: string, organicAlways: string[]): boolean {
  const n = normalizeLine(itemName);
  if (!n) return false;
  for (const raw of organicAlways) {
    const token = normalizeLine(raw);
    if (!token) continue;
    if (n === token) return true;
    const re = new RegExp(`(^|\\b)${escapeRegex(token)}(\\b|$)`, 'i');
    if (re.test(n)) return true;
    // Allow partial matches (e.g. "spinazieblaadjes") but avoid noisy hits for very short tokens.
    if (token.length >= 4 && n.includes(token)) return true;
  }
  return false;
}
