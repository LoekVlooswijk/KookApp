import { getAppMeta, setAppMeta } from './appMeta';

const META_AI_REQUEST_LOG = 'ai_request_log';

let cached: boolean | null = null;

export function isAiRequestLogEnabledSync(): boolean {
  return cached === true;
}

export async function hydrateAiRequestLogPrefsFromDb(): Promise<void> {
  const v = await getAppMeta(META_AI_REQUEST_LOG);
  cached = v === '1';
}

export async function getAiRequestLogEnabled(): Promise<boolean> {
  const v = await getAppMeta(META_AI_REQUEST_LOG);
  cached = v === '1';
  return cached;
}

export async function setAiRequestLogEnabled(on: boolean): Promise<void> {
  await setAppMeta(META_AI_REQUEST_LOG, on ? '1' : '0');
  cached = on;
}
