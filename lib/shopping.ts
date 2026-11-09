/** Boodschappenlijst-aggregatie — client-side volgens plan (feature 8). */

import { getFullRecipe } from './recipesRepo';
import type { WeekPlanRow } from './weekPlansRepo';

export type AggregatedShoppingItem = {
  name: string;
  amount: number | null;
  unit: string | null;
};

function normName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

function stripVersPrefix(n: string): string {
  const t = n.trim();
  return t.replace(/^(vers(e)?\s+)/i, '');
}

function canonicalMergeName(name: string): { keyName: string; displayName: string } {
  const n = normName(stripVersPrefix(name));
  if (!n) return { keyName: '', displayName: '' };

  // Garlic clove naming varies ("knoflookteen" vs "knoflook teentje").
  // Keep this intentionally conservative so we don't merge e.g. knoflookpoeder.
  if (
    /^knoflook\s*(teen|teentje|tenen|teentjes)$/.test(n) ||
    /^knoflook(teentje|teen|tenen|teentjes)$/.test(n) ||
    /^(teen|teentje|tenen|teentjes)\s+knoflook$/.test(n)
  ) {
    return { keyName: 'knoflook', displayName: 'knoflook' };
  }

  // Common onion naming in recipes.
  if (n === 'ui' || n === 'uien') {
    return { keyName: 'ui', displayName: 'ui' };
  }

  const displayName = stripVersPrefix(name).trim();
  return { keyName: n, displayName: displayName || name.trim() };
}

/** For ui/knoflook, empty unit + any finite amount should still merge with "stuks" lines. */
function countishUnitKey(keyName: string, unitKeyRaw: string, amount: number | null): string {
  if (unitKeyRaw) return unitKeyRaw;
  if (amount == null || !Number.isFinite(amount)) return '';
  if (keyName === 'ui' || keyName === 'knoflook') return 'stuks';
  if (Math.abs(amount - Math.round(amount)) < 1e-9) return 'stuks';
  return '';
}

/** Canonical unit token so e.g. "gram" and "g" merge into one shopping line. */
export function normUnit(u: string | null): string {
  let raw = (u ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!raw) return '';
  raw = raw.replace(/\.$/, '');

  // UI / pieces: recipes use "stuk", "stuks", or UI text like "stuk(s)".
  if (raw === 'stuk(s)' || /^stuk\s*\(\s*s\s*\)$/.test(raw)) {
    raw = 'stuks';
  }

  const aliases: Record<string, string> = {
    gram: 'g',
    gr: 'g',
    milliliter: 'ml',
    milliliters: 'ml',
    liter: 'l',
    litres: 'l',
    litre: 'l',
    el: 'el',
    eetlepel: 'el',
    eetlepels: 'el',
    tl: 'tl',
    theelepel: 'tl',
    theelepels: 'tl',
    stuk: 'stuks',
    stuks: 'stuks',
    stukje: 'stuks',
    stukjes: 'stuks',
    teen: 'teen',
    teens: 'teen',
    teentje: 'teen',
    teentjes: 'teen',
    tenen: 'teen',
    tbsp: 'el',
    tsp: 'tl',
  };
  return aliases[raw] ?? raw;
}

export type AggregatedShoppingItemInput = {
  name: string;
  amount: number | null;
  unit: string | null;
};

function mergeShoppingLinesIntoMap(
  out: Map<string, { name: string; unit: string | null; amount: number | null }>,
  name: string,
  unit: string | null,
  amount: number | null
): void {
  const trimmedName = name.trim();
  if (!trimmedName) return;
  const { keyName, displayName } = canonicalMergeName(trimmedName);
  if (!keyName) return;
  const unitTrim = (unit ?? '').trim() || null;
  const unitKeyRaw = normUnit(unitTrim);
  const unitKey = countishUnitKey(keyName, unitKeyRaw, amount);
  const key = `${keyName}|${unitKey}`;
  const cur = out.get(key);

  if (amount == null || !Number.isFinite(amount)) {
    if (!cur) out.set(key, { name: displayName, unit: unitTrim, amount: null });
    return;
  }

  const scaled = round2(amount);
  if (!cur) {
    out.set(key, { name: displayName, unit: unitTrim, amount: scaled });
  } else if (cur.amount == null) {
    out.set(key, { ...cur, name: displayName, unit: cur.unit ?? unitTrim, amount: null });
  } else {
    out.set(key, { ...cur, amount: round2(cur.amount + scaled) });
  }
}

/** Merge duplicate lines (same normalized name + unit); sums finite amounts. */
export function mergeAggregatedShoppingItems(
  items: AggregatedShoppingItemInput[]
): AggregatedShoppingItem[] {
  const out = new Map<string, { name: string; unit: string | null; amount: number | null }>();
  for (const it of items) {
    mergeShoppingLinesIntoMap(out, it.name, it.unit, it.amount);
  }

  const byUnitMerged = [...out.values()];

  // Fallback: if we still have multiple lines for the same ingredient name (but different unit),
  // combine them into one line by name and show quantities joined with "+".
  const linesByName = new Map<
    string,
    { displayName: string; amount: number | null; unit: string | null }[]
  >();
  for (const it of byUnitMerged) {
    const { keyName, displayName } = canonicalMergeName(it.name);
    if (!keyName) continue;
    const arr = linesByName.get(keyName) ?? [];
    arr.push({ displayName, amount: it.amount, unit: it.unit });
    linesByName.set(keyName, arr);
  }

  const final: AggregatedShoppingItem[] = [];
  for (const [keyName, arr] of linesByName) {
    if (arr.length <= 1) {
      const one = arr[0];
      if (one) final.push({ name: one.displayName, amount: one.amount, unit: one.unit });
      continue;
    }

    // Only collapse into "a + b + c" when we have numeric amounts for all parts.
    // If some lines are non-numeric, keep them as separate lines to avoid losing detail.
    const allNumeric = arr.every((x) => x.amount != null && Number.isFinite(x.amount));
    if (!allNumeric) {
      for (const it of arr) {
        final.push({ name: it.displayName, amount: it.amount, unit: it.unit });
      }
      continue;
    }

    // Prefer the shortest reasonable display name (after canonicalization).
    const sortedNames = [...arr]
      .map((x) => x.displayName.trim())
      .filter(Boolean)
      .sort((a, b) => a.length - b.length);
    const displayName = sortedNames[0] ?? keyName;

    const parts: string[] = [];
    for (const it of arr) {
      const amt = String(round2(it.amount!));
      const u = (it.unit ?? '').trim();
      parts.push(u ? `${amt} ${u}` : amt);
    }

    // Store the combined quantities in `unit` so the UI can render it even when `amount` is null.
    final.push({ name: displayName, amount: null, unit: parts.join(' + ') });
  }

  return final.sort((a, b) => a.name.localeCompare(b.name, 'nl'));
}

export function isStaple(ingredientName: string, staples: string[]): boolean {
  const n = normName(ingredientName);
  if (!n) return false;
  for (const st of staples) {
    const token = normName(st);
    if (!token) continue;
    if (n === token) return true;
    // Keep it conservative: match whole word occurrences.
    const re = new RegExp(`(^|\\b)${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\b|$)`, 'i');
    if (re.test(n)) return true;
  }
  return false;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function aggregateShoppingFromWeekPlans(params: {
  plans: WeekPlanRow[];
  staplesExclude: string[];
}): Promise<AggregatedShoppingItem[]> {
  const out = new Map<string, { name: string; unit: string | null; amount: number | null }>();

  // Totaal aantal porties per kookbeurt:
  // - kookdag telt mee
  // - alle restjesdagen die naar die kookdag verwijzen tellen ook mee
  const totalServingsByCookDate = new Map<string, number>();
  for (const p of params.plans) {
    const cookDate = (p.leftoverOfDate ?? p.date).trim();
    totalServingsByCookDate.set(
      cookDate,
      (totalServingsByCookDate.get(cookDate) ?? 0) + p.servings
    );
  }

  for (const p of params.plans) {
    // Restjesdagen zijn al "betaald" door de eerdere kookdag: niet dubbel tellen.
    if (p.leftoverOfDate != null) continue;
    // Tekstlabel-dagen (bijv. "Uit eten") hebben geen ingrediënten.
    if (p.recipeId == null) continue;
    const recipe = await getFullRecipe(p.recipeId);
    if (!recipe) continue;
    const base = recipe.baseServings ?? 4;
    const totalServings = totalServingsByCookDate.get(p.date) ?? p.servings;
    const factor = base > 0 ? totalServings / base : 1;

    for (const g of recipe.ingredientGroups) {
      for (const ing of g.ingredients) {
        const name = ing.name.trim();
        if (!name) continue;
        if (isStaple(name, params.staplesExclude)) continue;

        const unit = (ing.unit ?? '').trim() || null;
        const scaled =
          ing.amount != null && Number.isFinite(ing.amount) ? round2(ing.amount * factor) : null;
        mergeShoppingLinesIntoMap(out, name, unit, scaled);
      }
    }
  }

  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name, 'nl'));
}
