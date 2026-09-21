import { canonicalIngredientUnit, isMassUnit, isNonScalableUnit, isVolumeUnit } from './units';

export const MIN_SERVINGS = 1;
export const MAX_SERVINGS = 99;

export function effectiveBaseServings(base: number | null | undefined): number {
  if (base == null || !Number.isFinite(base) || base <= 0) return 4;
  return Math.floor(base);
}

export function servingFactor(
  targetServings: number,
  baseServings: number | null | undefined
): number {
  const b = effectiveBaseServings(baseServings);
  const t = Math.max(MIN_SERVINGS, Math.min(MAX_SERVINGS, Math.round(targetServings)));
  return t / b;
}

function trimNumber(n: number): string {
  if (!Number.isFinite(n)) return '';
  const r = Math.round(n * 1000) / 1000;
  if (Math.abs(r - Math.round(r)) < 1e-9) return String(Math.round(r));
  return r.toFixed(2).replace(/\.?0+$/, '');
}

/** Zet hoeveelheid + eenheid om naar gram (massa) of ml (volume) voor schaling. */
function toBaseAmount(amount: number, unit: string | null): { grams?: number; ml?: number } | null {
  const c = canonicalIngredientUnit(unit);
  if (c == null) return null;
  if (c === 'g') return { grams: amount };
  if (c === 'kg') return { grams: amount * 1000 };
  if (c === 'ml') return { ml: amount };
  if (c === 'l') return { ml: amount * 1000 };
  return null;
}

function formatMass(grams: number): { amount: string; unit: string } {
  return { amount: trimNumber(grams), unit: 'g' };
}

function formatVolume(ml: number): { amount: string; unit: string } {
  return { amount: trimNumber(ml), unit: 'ml' };
}

/**
 * Schaal hoeveelheid voor weergave. snuf / naar smaak: geen schaling van hoeveelheid.
 * Massa/volume: altijd g en ml tonen.
 */
export function scaleIngredientQuantity(
  amount: number | null,
  unit: string | null,
  factor: number
): { prefix: string; unitForDisplay: string | null } {
  const uRaw = unit?.trim() ?? '';
  const uCanon = canonicalIngredientUnit(unit);

  if (isNonScalableUnit(unit)) {
    if (amount != null && Number.isFinite(amount)) {
      return { prefix: trimNumber(amount), unitForDisplay: uRaw || uCanon || null };
    }
    return { prefix: '', unitForDisplay: uRaw || uCanon || null };
  }

  if (amount == null || !Number.isFinite(amount)) {
    return { prefix: '', unitForDisplay: uRaw || null };
  }

  if (isMassUnit(unit)) {
    const base = toBaseAmount(amount, unit);
    if (base?.grams != null) {
      const g = base.grams * factor;
      const { amount: a, unit: un } = formatMass(g);
      return { prefix: a, unitForDisplay: un };
    }
  }

  if (isVolumeUnit(unit)) {
    const base = toBaseAmount(amount, unit);
    if (base?.ml != null) {
      const ml = base.ml * factor;
      const { amount: a, unit: un } = formatVolume(ml);
      return { prefix: a, unitForDisplay: un };
    }
  }

  const scaled = amount * factor;
  const displayUnit = uRaw || uCanon || '';
  return { prefix: trimNumber(scaled), unitForDisplay: displayUnit || null };
}

/** Hoeveelheid + eenheid (leeg als alleen naam). */
export function scaledIngredientDisplayParts(
  amount: number | null,
  unit: string | null,
  name: string,
  factor: number
): { qty: string; name: string } {
  const { prefix, unitForDisplay } = scaleIngredientQuantity(amount, unit, factor);
  const bits: string[] = [];
  if (prefix) bits.push(prefix);
  if (unitForDisplay) bits.push(unitForDisplay);
  const qty = bits.join(' ').trim();
  return { qty, name: name.trim() };
}

/** Eén regel: "250 g — bloem". */
export function formatScaledIngredientLine(
  amount: number | null,
  unit: string | null,
  name: string,
  factor: number
): string {
  const { qty, name: n } = scaledIngredientDisplayParts(amount, unit, name, factor);
  if (!qty) return n;
  return `${qty} — ${n}`;
}
