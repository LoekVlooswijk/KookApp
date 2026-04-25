import { getAppMeta, setAppMeta } from './appMeta';

const META_CUSTOM_DIETS = 'custom_diets_v1';

export function normalizeDietName(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

export type CustomDiet = { name: string };

export async function getCustomDiets(): Promise<CustomDiet[]> {
  const raw = await getAppMeta(META_CUSTOM_DIETS);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const out: CustomDiet[] = [];
    for (const x of parsed) {
      const name = normalizeDietName(typeof x === 'string' ? x : (x as any)?.name);
      if (!name || seen.has(name)) continue;
      seen.add(name);
      out.push({ name });
    }
    return out;
  } catch {
    return [];
  }
}

export async function setCustomDiets(diets: CustomDiet[]): Promise<void> {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of diets) {
    const name = normalizeDietName(d.name);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  await setAppMeta(META_CUSTOM_DIETS, JSON.stringify(out));
}

export async function addCustomDiet(name: string): Promise<CustomDiet[]> {
  const n = normalizeDietName(name);
  if (!n) return getCustomDiets();
  const cur = await getCustomDiets();
  if (cur.some((d) => d.name === n)) return cur;
  const next = [...cur, { name: n }].sort((a, b) => a.name.localeCompare(b.name, 'nl'));
  await setCustomDiets(next);
  return next;
}

export async function removeCustomDiet(name: string): Promise<CustomDiet[]> {
  const n = normalizeDietName(name);
  const cur = await getCustomDiets();
  const next = cur.filter((d) => d.name !== n);
  await setCustomDiets(next);
  return next;
}

