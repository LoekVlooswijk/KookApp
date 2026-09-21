import type { RecipeSavePayload } from './types';

export function coerceBioScoreColor(x: unknown): RecipeSavePayload['bioScoreColor'] {
  const c = typeof x === 'string' ? x.trim().toLowerCase() : '';
  return c === 'red' || c === 'orange' || c === 'green' ? c : null;
}

export function coerceBioScoreItems(x: unknown): RecipeSavePayload['bioScoreItems'] {
  if (!Array.isArray(x)) return null;
  const out: NonNullable<RecipeSavePayload['bioScoreItems']> = [];
  for (const it of x) {
    if (!it || typeof it !== 'object') continue;
    const rec = it as Record<string, unknown>;
    const n = typeof rec.n === 'string' ? rec.n.trim().toLowerCase() : '';
    const l = rec.l;
    const p = rec.p;
    if (!n) continue;
    if (l !== 'G' && l !== 'O' && l !== 'R') continue;
    if (p !== 'L' && p !== 'M' && p !== 'H') continue;
    out.push({ n, l, p });
  }
  return out.length > 0 ? out : null;
}

function parseIntOrNull(s: unknown): number | null {
  if (typeof s === 'number' && Number.isFinite(s)) return Math.round(s);
  if (typeof s === 'string' && s.trim()) {
    const n = Number.parseInt(s.trim(), 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function parseAmountOrNull(x: unknown): number | null {
  if (typeof x === 'number' && Number.isFinite(x)) return x;
  if (typeof x === 'string' && x.trim()) {
    const n = Number.parseFloat(x.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Ensures every recipe save/import path has a complete, DB-safe payload shape. */
export function normalizeRecipeSavePayload(
  partial: Partial<RecipeSavePayload> & {
    title: string;
    ingredientGroups: RecipeSavePayload['ingredientGroups'];
    stepSections: RecipeSavePayload['stepSections'];
  }
): RecipeSavePayload {
  const baseRaw = partial.baseServings;
  const baseParsed =
    typeof baseRaw === 'number' && Number.isFinite(baseRaw)
      ? Math.round(baseRaw)
      : parseIntOrNull(baseRaw);
  const baseServings = baseParsed != null && baseParsed > 0 ? Math.min(99, baseParsed) : 4;

  const ingredientGroups = (
    Array.isArray(partial.ingredientGroups) ? partial.ingredientGroups : []
  ).map((g) => ({
    title: (g.title ?? '').trim(),
    ingredients: (Array.isArray(g.ingredients) ? g.ingredients : [])
      .map((ing) => ({
        name: (ing.name ?? '').trim(),
        amount: parseAmountOrNull(ing.amount),
        unit: (ing.unit ?? '').trim() || null,
      }))
      .filter((ing) => ing.name.length > 0),
  }));

  const stepSections = (Array.isArray(partial.stepSections) ? partial.stepSections : []).map(
    (s) => ({
      title: (s.title ?? '').trim(),
      steps: (Array.isArray(s.steps) ? s.steps : [])
        .map((st) => {
          let timerSeconds = parseIntOrNull(st.timerSeconds);
          if (timerSeconds != null && timerSeconds < 0) timerSeconds = null;
          return {
            description: (st.description ?? '').trim(),
            timerSeconds,
          };
        })
        .filter((st) => st.description.length > 0),
    })
  );

  const tagNames = (Array.isArray(partial.tagNames) ? partial.tagNames : [])
    .map((t) => (typeof t === 'string' ? t.trim() : ''))
    .filter(Boolean);

  const bioUpdatedRaw = partial.bioScoreUpdatedAt;
  const bioScoreUpdatedAt =
    typeof bioUpdatedRaw === 'string' && bioUpdatedRaw.trim() ? bioUpdatedRaw.trim() : null;

  return {
    title: (partial.title ?? '').trim(),
    description: (partial.description ?? '').trim(),
    sourceUrl: (partial.sourceUrl ?? '').trim(),
    baseServings,
    prepTimeMin: parseIntOrNull(partial.prepTimeMin),
    cookTimeMin: parseIntOrNull(partial.cookTimeMin),
    totalTimeMin: parseIntOrNull(partial.totalTimeMin),
    category: (partial.category ?? '').trim(),
    dietVegetarian: !!partial.dietVegetarian,
    dietVegan: !!partial.dietVegan,
    dietKeto: !!partial.dietKeto,
    isFavorite: !!partial.isFavorite,
    wantToTry: !!partial.wantToTry,
    bioScoreColor: coerceBioScoreColor(partial.bioScoreColor),
    bioScoreUpdatedAt,
    bioScoreItems: coerceBioScoreItems(partial.bioScoreItems),
    notes: (partial.notes ?? '').trim(),
    imageUri: (partial.imageUri ?? '').trim(),
    tagNames,
    ingredientGroups,
    stepSections,
  };
}

/** Count `?` placeholders in a SQL VALUES/SET fragment — used in tests to catch column drift. */
export function countSqlPlaceholders(sql: string): number {
  return (sql.match(/\?/g) ?? []).length;
}
