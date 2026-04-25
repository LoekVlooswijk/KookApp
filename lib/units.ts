/** Canonieke eenheden + synoniemen — zie kookapp_plan_v2.html */

export function normalizeUnitToken(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

const SYNONYM_TO_CANONICAL: Record<string, string> = {
  gram: 'g',
  grams: 'g',
  gr: 'g',
  kilogram: 'kg',
  kilograms: 'kg',
  kilo: 'kg',
  milliliter: 'ml',
  milliliters: 'ml',
  millilitre: 'ml',
  liter: 'l',
  liters: 'l',
  litres: 'l',
  eetlepel: 'el',
  eetlepels: 'el',
  theelepel: 'tl',
  theelepels: 'tl',
  stuks: 'stuk',
  stuk: 'stuk',
  stukken: 'stuk',
};

/** Map user/DB unit naar canonieke token (g, kg, ml, l, el, tl, stuk, teen, plak, tak, blad, snuf, naar smaak, …). */
export function canonicalIngredientUnit(unit: string | null | undefined): string | null {
  if (unit == null) return null;
  const t = normalizeUnitToken(unit);
  if (!t) return null;
  if (t.includes('naar smaak')) return 'naar smaak';
  return SYNONYM_TO_CANONICAL[t] ?? t;
}

const NON_SCALABLE = new Set(['snuf', 'naar smaak']);

export function isNonScalableUnit(unit: string | null | undefined): boolean {
  const c = canonicalIngredientUnit(unit);
  if (!c) return false;
  if (NON_SCALABLE.has(c)) return true;
  if (c.includes('naar smaak')) return true;
  return false;
}

export function isMassUnit(unit: string | null | undefined): boolean {
  const c = canonicalIngredientUnit(unit);
  return c === 'g' || c === 'kg';
}

export function isVolumeUnit(unit: string | null | undefined): boolean {
  const c = canonicalIngredientUnit(unit);
  return c === 'ml' || c === 'l';
}
