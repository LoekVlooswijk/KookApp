import { getAppMeta, setAppMeta } from './appMeta';

const META_IMPORT_EXTRACT_CONCURRENCY = 'import_extract_concurrency';

export async function getImportExtractConcurrency(): Promise<number> {
  const v = await getAppMeta(META_IMPORT_EXTRACT_CONCURRENCY);
  const n = v != null ? Number.parseInt(v, 10) : NaN;
  // Default: 6 (fast, but still reasonable for request-rate limits).
  if (!Number.isFinite(n)) return 6;
  return Math.max(1, Math.min(10, n));
}

export async function setImportExtractConcurrency(n: number): Promise<void> {
  const v = Math.max(1, Math.min(10, Math.round(n)));
  await setAppMeta(META_IMPORT_EXTRACT_CONCURRENCY, String(v));
}

