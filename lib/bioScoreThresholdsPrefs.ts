import { deleteAppMeta, getAppMeta, setAppMeta } from './appMeta';

export const BIO_SCORE_THRESHOLDS_META_KEY = 'bio_score_thresholds_v1';

export type BioScoreThresholds = {
  /** Minimum total points for orange (inclusive). */
  orangeMin: number;
  /** Minimum total points for red (inclusive); must be strictly greater than orangeMin. */
  redMin: number;
};

const DEFAULT_THRESHOLDS: BioScoreThresholds = {
  orangeMin: 3,
  redMin: 4,
};

let cache: BioScoreThresholds = { ...DEFAULT_THRESHOLDS };

function clampInt(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  const r = Math.round(n);
  return Math.min(hi, Math.max(lo, r));
}

/** Clamp and enforce redMin > orangeMin. */
export function normalizeBioScoreThresholds(
  partial: Partial<BioScoreThresholds>
): BioScoreThresholds {
  let orangeMin = clampInt(partial.orangeMin ?? DEFAULT_THRESHOLDS.orangeMin, 1, 98);
  let redMin = clampInt(partial.redMin ?? DEFAULT_THRESHOLDS.redMin, 2, 99);
  if (redMin <= orangeMin) {
    redMin = Math.min(99, orangeMin + 1);
  }
  return { orangeMin, redMin };
}

export function getBioScoreThresholds(): BioScoreThresholds {
  return { ...cache };
}

export async function hydrateBioScoreThresholdsFromDb(): Promise<void> {
  const raw = await getAppMeta(BIO_SCORE_THRESHOLDS_META_KEY);
  if (!raw) {
    cache = { ...DEFAULT_THRESHOLDS };
    return;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      cache = { ...DEFAULT_THRESHOLDS };
      return;
    }
    const rec = parsed as Record<string, unknown>;
    const orangeMin =
      typeof rec.orangeMin === 'number' ? rec.orangeMin : DEFAULT_THRESHOLDS.orangeMin;
    const redMin = typeof rec.redMin === 'number' ? rec.redMin : DEFAULT_THRESHOLDS.redMin;
    cache = normalizeBioScoreThresholds({ orangeMin, redMin });
  } catch {
    cache = { ...DEFAULT_THRESHOLDS };
  }
}

export async function setBioScoreThresholds(next: Partial<BioScoreThresholds>): Promise<void> {
  const norm = normalizeBioScoreThresholds({
    orangeMin: next.orangeMin ?? cache.orangeMin,
    redMin: next.redMin ?? cache.redMin,
  });
  cache = norm;
  await setAppMeta(BIO_SCORE_THRESHOLDS_META_KEY, JSON.stringify(norm));
}

export async function resetBioScoreThresholdsToDefaults(): Promise<void> {
  cache = { ...DEFAULT_THRESHOLDS };
  await deleteAppMeta(BIO_SCORE_THRESHOLDS_META_KEY);
}
