import { deleteAppMeta, getAppMeta, setAppMeta } from './appMeta';
import {
  matchesAnyBioScoreToken,
  matchesBioScoreIngredientToken,
  normalizeBioScoreIngredientName,
} from './bioScoreNameMatch';

export const BIO_SCORE_EXCLUDE_META_KEY = 'bio_score_exclude_v1';

let excludeCache: string[] = [];

function normalizeList(lines: unknown): string[] {
  const arr = Array.isArray(lines) ? lines : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of arr) {
    const t = normalizeBioScoreIngredientName(typeof x === 'string' ? x : '');
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

export function getBioScoreExcludeList(): string[] {
  return excludeCache;
}

export async function hydrateBioScoreExcludePrefsFromDb(): Promise<void> {
  const raw = await getAppMeta(BIO_SCORE_EXCLUDE_META_KEY);
  if (!raw) {
    excludeCache = [];
    return;
  }
  try {
    excludeCache = normalizeList(JSON.parse(raw) as unknown);
  } catch {
    excludeCache = [];
  }
}

export async function setBioScoreExcludeList(lines: string[]): Promise<void> {
  const list = normalizeList(lines);
  excludeCache = list;
  if (list.length === 0) {
    await deleteAppMeta(BIO_SCORE_EXCLUDE_META_KEY);
    return;
  }
  await setAppMeta(BIO_SCORE_EXCLUDE_META_KEY, JSON.stringify(list));
}

export function bioScoreExcludeTextToList(text: string): string[] {
  return normalizeList(
    String(text ?? '')
      .split(/\r?\n/g)
      .map((x) => normalizeBioScoreIngredientName(x))
      .filter(Boolean)
  );
}

export function bioScoreExcludeListToText(lines: string[]): string {
  return (Array.isArray(lines) ? lines : [])
    .map((x) => x.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

export function isBioScoreExcludedName(name: string): boolean {
  return matchesAnyBioScoreToken(name, excludeCache);
}

export async function addToBioScoreExcludeList(name: string): Promise<void> {
  await hydrateBioScoreExcludePrefsFromDb();
  const n = normalizeBioScoreIngredientName(name);
  if (!n) return;
  const list = [...excludeCache];
  if (list.some((t) => matchesBioScoreIngredientToken(n, t))) return;
  list.push(n);
  await setBioScoreExcludeList(list);
}
