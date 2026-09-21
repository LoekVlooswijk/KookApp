import { getAppMeta, setAppMeta } from './appMeta';

const META_IMPORT_AH_SITE_SEARCH = 'import_ah_site_search';

/**
 * Prefer using AH/Allerhande site search to resolve URLs from recipe titles.
 * Default: ON (when unset), since it avoids expensive AI web_search calls.
 */
export async function getImportAhSiteSearchEnabled(): Promise<boolean> {
  const v = await getAppMeta(META_IMPORT_AH_SITE_SEARCH);
  if (v == null) return true;
  return v === '1';
}

export async function setImportAhSiteSearchEnabled(on: boolean): Promise<void> {
  await setAppMeta(META_IMPORT_AH_SITE_SEARCH, on ? '1' : '0');
}
