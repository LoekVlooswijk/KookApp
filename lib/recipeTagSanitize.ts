/**
 * Ruimt geïmporteerde recept-tags op: synoniemen, overlap maaltijd vs gang,
 * canonieke dieetlabels, en bekende ruis. Handmatig ingevoerde tags in het
 * formulier gaan niet door deze functie.
 */

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** NL + EN gangen — één canonieke vorm per synoniem. */
const TAG_SYNONYMS = new Map<string, string>([
  ['veganistisch', 'vegan'],
  ['hoofdgang', 'hoofdgerecht'],
  ['hoofd gerecht', 'hoofdgerecht'],
  ['main course', 'hoofdgerecht'],
  ['maincourse', 'hoofdgerecht'],
  ['starter', 'voorgerecht'],
  ['appetizer', 'voorgerecht'],
  ['dessert', 'nagerecht'],
  ['toetje', 'nagerecht'],
  ['nachtisch', 'nagerecht'],
  ['side dish', 'bijgerecht'],
  ['side', 'bijgerecht'],
]);

const COURSE_TAGS = new Set([
  'hoofdgerecht',
  'voorgerecht',
  'nagerecht',
  'bijgerecht',
  'tussengerecht',
]);

/** Maaltijdmoment; overbodig zodra er al een gang-tag is (na herschrijven van diner e.d.). */
const MEAL_TIME_TAGS = new Set([
  'diner',
  'lunch',
  'ontbijt',
  'brunch',
  'borrel',
  'avondeten',
  'middageten',
  'high tea',
]);

const VEGAN_TAGS = new Set(['vegan', 'plantaardig']);

/** Generieke sitetags die we niet als zoeklabel willen. */
const BLOCKED_TAGS = new Set(
  [
    'ah',
    'albert heijn',
    'allerhande',
    'jumbo',
    'lidl',
    'plus',
    'coop',
    'recept',
    'recepten',
    'makkelijk',
    'simpel',
    'eenvoudig',
    'snel',
  ].map((s) => norm(s))
);

/** "Zonder vlees/vis"-achtige labels → één tag `vegetarisch` voor filteren. */
function impliesVegetarianTag(t: string): boolean {
  if (!t || /\bpescetarisch\b/.test(t) || /\bpesco\b/.test(t)) return false;
  if (t === 'vleesloos' || t.includes('vleesloos')) return true;
  if (t.includes('zonder vlees') || t.includes('zonder vis')) return true;
  if (/\bzonder\s+vlees\s*\/\s*vis\b/.test(t)) return true;
  if (/\bzonder\s+vlees\s*,\s*vis\b/.test(t)) return true;
  if (/\bvrij\s+van\s+vlees\b/.test(t) && /\bvis\b/.test(t)) return true;
  if (/\bvlees\s*-\s*en\s*visvrij\b/.test(t) || /\bvlees\s+en\s+visvrij\b/.test(t)) return true;
  if (t.includes('geen vlees') && t.includes('geen vis')) return true;
  if (t.includes('meat-free') || t.includes('meat free')) return true;
  if (t.includes('without meat')) return true;
  return false;
}

/** Maaltijdmoment dat we als hoofdgang willen taggen (i.p.v. los "diner"). */
function mealToMainCourse(t: string): string | null {
  if (t === 'diner' || t === 'avondeten') return 'hoofdgerecht';
  return null;
}

function rewriteOneTag(raw: string): string {
  const t = norm(raw);
  if (!t || BLOCKED_TAGS.has(t)) return '';

  if (impliesVegetarianTag(t)) return 'vegetarisch';

  const asMain = mealToMainCourse(t);
  if (asMain) return asMain;

  return TAG_SYNONYMS.get(t) ?? t;
}

const ING_WORD_RE = /[\p{L}]{2,}/gu;

/**
 * Verwijdert tags die hetzelfde zijn als een ingrediënt(woord) of een duidelijke
 * samenstelling daarvan (bijv. tag `venkel` bij `venkelknol`). Geen match op
 * alleen uitgang `-e` (bijv. `italiaans` vs `italiaanse kruiden`).
 */
export function shouldDropTagAsIngredientDuplicate(
  tagNormalized: string,
  ingredientNames: string[]
): boolean {
  const tag = norm(tagNormalized);
  if (!tag || tag.length < 3 || !ingredientNames.length) return false;

  for (const raw of ingredientNames) {
    const line = norm(typeof raw === 'string' ? raw : '');
    if (!line) continue;
    const words = line.match(ING_WORD_RE) ?? [];
    for (const word of words) {
      const w = word.toLowerCase();
      if (w === tag) return true;
      // Samengestelde produktnamen (venkelknol), niet bijvoeglijke `-e`.
      if (tag.length >= 4 && w.length > tag.length && w.startsWith(tag)) {
        const suffix = w.slice(tag.length);
        if (suffix.length === 1 && suffix === 'e') continue;
        return true;
      }
    }
  }
  return false;
}

/**
 * Na AI-extractie: herschrijven, dedup, gang vs resterend maaltijd, vegan > vegetarisch.
 * Behoudt volgorde van eerste voorkomen.
 * Optioneel: laat tags weg die overeenkomen met ingrediëntnamen.
 */
export function sanitizeImportedRecipeTags(
  rawTags: string[],
  options?: { ingredientNames?: string[] }
): string[] {
  const ingredientNames = options?.ingredientNames ?? [];
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const raw of rawTags) {
    if (typeof raw !== 'string') continue;
    const r = rewriteOneTag(raw);
    if (!r || seen.has(r)) continue;
    if (shouldDropTagAsIngredientDuplicate(r, ingredientNames)) continue;
    seen.add(r);
    ordered.push(r);
  }

  const hasVegan = ordered.some((t) => VEGAN_TAGS.has(t));
  let out = hasVegan ? ordered.filter((t) => t !== 'vegetarisch') : ordered;

  const hasCourse = out.some((t) => COURSE_TAGS.has(t));
  if (hasCourse) {
    out = out.filter((t) => !MEAL_TIME_TAGS.has(t));
  }

  return out;
}

/** Vaste volgorde voor snelle filters op het receptenoverzicht (alleen tonen als ze voorkomen). */
export const BROWSE_PIN_TAGS = ['vegetarisch', 'vegan', 'hoofdgerecht'] as const;

/**
 * Tags die niet in de tagfilter-lijst thuishoren (maaltijd­momenten, «wat eten we…»-labels van sites).
 */
export function isTagHiddenFromBrowseFilters(name: string): boolean {
  const t = norm(name);
  if (!t) return true;
  if (MEAL_TIME_TAGS.has(t)) return true;
  // Dieetlabels worden aparte booleans (niet als gewone tags filteren).
  if (t === 'vegetarisch' || t === 'vegan' || t === 'keto') return true;
  // Custom diets are stored as `diet:<name>` tags (not shown as normal tags).
  if (t.startsWith('diet:')) return true;
  if (/\bwat\s+eten\s+we\b/.test(t)) return true;
  if (/\bwat\s+eten\s+jullie\b/.test(t)) return true;
  if (/\bwat\s+eten\s+je\b/.test(t)) return true;
  return false;
}

/** Na normalisatie (trim/lower): sla `veganistisch` op als `vegan` in de database. */
export function canonicalStoredTagName(normalized: string): string {
  if (normalized === 'veganistisch') return 'vegan';
  return normalized;
}

export type DietFlags = {
  dietVegetarian: boolean;
  dietVegan: boolean;
  dietKeto: boolean;
};

/**
 * Haal dieet-informatie uit een taglijst (en verwijder die tags uit de resterende tags).
 * Vegan impliceert vegetarisch.
 */
export function extractDietFromTags(tagNames: string[]): DietFlags & { tagNames: string[] } {
  const inTags = Array.isArray(tagNames) ? tagNames : [];
  let veg = false;
  let vegan = false;
  let keto = false;
  const out: string[] = [];
  for (const raw of inTags) {
    const t = canonicalStoredTagName(norm(raw));
    if (!t) continue;
    if (t === 'vegan') {
      vegan = true;
      veg = true;
      continue;
    }
    if (t === 'vegetarisch') {
      veg = true;
      continue;
    }
    if (t === 'keto') {
      keto = true;
      continue;
    }
    out.push(t);
  }
  return { dietVegetarian: veg, dietVegan: vegan, dietKeto: keto, tagNames: out };
}
