import { getAppMeta, setAppMeta } from './appMeta';

export const BIO_SCORE_ENABLED_META_KEY = 'bio_score_enabled_v1';

let cache = true;

/** Whether the bio-score feature (leaves, buttons, prompts UI) is shown. Default: enabled. */
export function isBioScoreEnabled(): boolean {
  return cache;
}

export async function hydrateBioScoreEnabledFromDb(): Promise<void> {
  const raw = await getAppMeta(BIO_SCORE_ENABLED_META_KEY);
  if (raw == null) {
    cache = true;
    return;
  }
  cache = raw.trim() === 'true';
}

/**
 * Persist the enabled state. Data (scores on recipes, thresholds, exclusions,
 * overrides) is never touched — this only toggles visibility and actions.
 */
export async function setBioScoreEnabled(next: boolean): Promise<void> {
  cache = next;
  await setAppMeta(BIO_SCORE_ENABLED_META_KEY, next ? 'true' : 'false');
}
