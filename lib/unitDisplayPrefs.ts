import { getAppMeta, setAppMeta } from './appMeta';

const META_MASS_G = 'pref_mass_g_before_kg';
const META_VOLUME_ML = 'pref_volume_ml_before_l';

export type GramKgThreshold = 500 | 1000;
export type MlLThreshold = 500 | 1000;

let massTh: GramKgThreshold = 1000;
let volTh: MlLThreshold = 1000;

/** Call once after `ensureDatabaseAsync()` so sync formatters read real prefs. */
export async function hydrateUnitDisplayPrefsFromDb(): Promise<void> {
  const vMass = await getAppMeta(META_MASS_G);
  massTh = vMass === '500' ? 500 : 1000;
  const vVol = await getAppMeta(META_VOLUME_ML);
  volTh = vVol === '500' ? 500 : 1000;
}

export function getMassGramsBeforeKg(): GramKgThreshold {
  return massTh;
}

export function getVolumeMlBeforeL(): MlLThreshold {
  return volTh;
}

export async function setMassGramsBeforeKg(n: GramKgThreshold): Promise<void> {
  massTh = n;
  await setAppMeta(META_MASS_G, String(n));
}

export async function setVolumeMlBeforeL(n: MlLThreshold): Promise<void> {
  volTh = n;
  await setAppMeta(META_VOLUME_ML, String(n));
}
