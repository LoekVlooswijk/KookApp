import { getAppMeta, setAppMeta } from './appMeta';

const META_IMPORT_WEB_SEARCH = 'import_web_search';

export async function getImportWebSearchEnabled(): Promise<boolean> {
  const v = await getAppMeta(META_IMPORT_WEB_SEARCH);
  return v === '1';
}

export async function setImportWebSearchEnabled(on: boolean): Promise<void> {
  await setAppMeta(META_IMPORT_WEB_SEARCH, on ? '1' : '0');
}

