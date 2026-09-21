import { deleteAppMeta, getAppMeta, setAppMeta } from './appMeta';
import {
  matchesBioScoreIngredientToken,
  normalizeBioScoreIngredientName,
} from './bioScoreNameMatch';

export const BIO_SCORE_OVERRIDES_META_KEY = 'bio_score_overrides_v1';

export type BioScoreOverride = {
  n: string;
  l: 'G' | 'O' | 'R';
  p: 'L' | 'M' | 'H';
};

let overridesCache: BioScoreOverride[] = [];

function isLocalityCode(x: unknown): x is BioScoreOverride['l'] {
  return x === 'G' || x === 'O' || x === 'R';
}

function isPesticideCode(x: unknown): x is BioScoreOverride['p'] {
  return x === 'L' || x === 'M' || x === 'H';
}

function normalizeOverrides(raw: unknown): BioScoreOverride[] {
  if (!Array.isArray(raw)) return [];
  const out: BioScoreOverride[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const rec = row as Record<string, unknown>;
    const n = normalizeBioScoreIngredientName(typeof rec.n === 'string' ? rec.n : '');
    const l = rec.l;
    const p = rec.p;
    if (!n || !isLocalityCode(l) || !isPesticideCode(p)) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push({ n, l, p });
  }
  return out;
}

export function getBioScoreOverridesList(): BioScoreOverride[] {
  return overridesCache;
}

export async function hydrateBioScoreOverridesPrefsFromDb(): Promise<void> {
  const raw = await getAppMeta(BIO_SCORE_OVERRIDES_META_KEY);
  if (!raw) {
    overridesCache = [];
    return;
  }
  try {
    overridesCache = normalizeOverrides(JSON.parse(raw) as unknown);
  } catch {
    overridesCache = [];
  }
}

export async function setBioScoreOverridesList(overrides: BioScoreOverride[]): Promise<void> {
  overridesCache = normalizeOverrides(overrides);
  if (overridesCache.length === 0) {
    await deleteAppMeta(BIO_SCORE_OVERRIDES_META_KEY);
    return;
  }
  await setAppMeta(BIO_SCORE_OVERRIDES_META_KEY, JSON.stringify(overridesCache));
}

export function findBioScoreOverrideForName(
  name: string,
  overrides: BioScoreOverride[] = overridesCache
): BioScoreOverride | null {
  let best: BioScoreOverride | null = null;
  let bestLen = 0;
  for (const ov of overrides) {
    if (!matchesBioScoreIngredientToken(name, ov.n)) continue;
    const len = normalizeBioScoreIngredientName(ov.n).length;
    if (len >= bestLen) {
      best = ov;
      bestLen = len;
    }
  }
  return best;
}

export async function upsertBioScoreOverride(override: BioScoreOverride): Promise<void> {
  await hydrateBioScoreOverridesPrefsFromDb();
  const n = normalizeBioScoreIngredientName(override.n);
  if (!n) return;
  const next = overridesCache.filter((o) => o.n !== n);
  next.push({ n, l: override.l, p: override.p });
  await setBioScoreOverridesList(next);
}

export async function removeBioScoreOverride(name: string): Promise<void> {
  await hydrateBioScoreOverridesPrefsFromDb();
  const n = normalizeBioScoreIngredientName(name);
  const next = overridesCache.filter((o) => o.n !== n);
  await setBioScoreOverridesList(next);
}
