/** Shared ingredient-name normalization and token matching for bio-score prefs. */

export function normalizeBioScoreIngredientName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whether `itemName` matches a configured token (exact, word, or substring for long tokens). */
export function matchesBioScoreIngredientToken(itemName: string, token: string): boolean {
  const n = normalizeBioScoreIngredientName(itemName);
  const t = normalizeBioScoreIngredientName(token);
  if (!n || !t) return false;
  if (n === t) return true;
  const re = new RegExp(`(^|\\b)${escapeRegex(t)}(\\b|$)`, 'i');
  if (re.test(n)) return true;
  if (t.length >= 4 && n.includes(t)) return true;
  return false;
}

export function matchesAnyBioScoreToken(itemName: string, tokens: string[]): boolean {
  for (const token of tokens) {
    if (matchesBioScoreIngredientToken(itemName, token)) return true;
  }
  return false;
}
