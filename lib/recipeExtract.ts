import { callAiText } from './aiClient';
import { buildAiRepairUserPrompt, buildRecipeExtractSystemPrompt, RECIPE_JSON_SCHEMA } from './aiPromptTemplates';
import {
  extractApplicationLdJsonScripts,
  filterRecipePageHtml,
  JSON_LD_BLOCKS_MARKER,
} from './recipePageHtmlFilter';
import { extractDietFromTags, sanitizeImportedRecipeTags } from './recipeTagSanitize';
import type { RecipeSavePayload } from './types';

// Keep this low to avoid org-level TPM spikes when importing multiple recipes in a row.
// The page filter appends JSON-LD blocks (often containing the full recipe), so we rarely
// need a huge raw HTML budget.
export const MAX_HTML_CHARS = 25_000;

// When we send JSON-LD only (no other page text), allow a bit more room so we don't cut the recipe payload itself.
const MAX_JSONLD_ONLY_CHARS = 60_000;

export const EXTRACT_SYSTEM_PROMPT = buildRecipeExtractSystemPrompt();

export function stripCodeFence(raw: string): string {
  let t = raw.trim();
  if (t.startsWith('```')) {
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
  }
  return t.trim();
}

/**
 * Sommige modellen plakken tekst vóór het JSON-object (bijv. "Ik heb het recept gevonden. {").
 * `JSON.parse` op de hele string faalt dan — begin pas bij de eerste "{".
 */
export function stripLeadingProseBeforeJson(raw: string): string {
  const t = stripCodeFence(raw).trim();
  const i = t.indexOf('{');
  if (i <= 0) return t;
  return t.slice(i);
}

/** Knip het eerste complete JSON-object af (telt accolades, respecteert strings). */
function trimToFirstCompleteJsonObject(s: string): string {
  const start = s.indexOf('{');
  if (start === -1) return s;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) {
        esc = false;
      } else if (c === '\\') {
        esc = true;
      } else if (c === '"') {
        inStr = false;
      }
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return s.slice(start);
}

/** Combineer: code fence weg, proza vóór "{", rest tot sluitende "}" van het root-object. */
export function coerceAnthropicJsonText(raw: string): string {
  const lead = stripLeadingProseBeforeJson(raw);
  return trimToFirstCompleteJsonObject(lead);
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return x != null && typeof x === 'object' && !Array.isArray(x);
}

function asString(x: unknown): string | null {
  if (typeof x === 'string') return x;
  if (typeof x === 'number' && Number.isFinite(x)) return String(x);
  return null;
}

function asNumberOrNull(x: unknown): number | null {
  if (x == null) return null;
  if (typeof x === 'number' && Number.isFinite(x)) return x;
  if (typeof x === 'string' && x.trim()) {
    const n = Number.parseFloat(x.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asIntOrNull(x: unknown): number | null {
  const n = asNumberOrNull(x);
  if (n == null) return null;
  return Math.round(n);
}

export function parseExtractedRecipeJson(
  modelText: string,
  sourceUrl: string
): { ok: true; payload: RecipeSavePayload } | { ok: false; reason: string } {
  let root: unknown;
  try {
    root = JSON.parse(stripCodeFence(modelText));
  } catch {
    return { ok: false, reason: 'Het antwoord is geen geldige JSON.' };
  }

  if (!isRecord(root)) {
    return { ok: false, reason: 'JSON moet een object zijn.' };
  }

  const title = (asString(root.title) ?? '').trim();
  if (!title) {
    return { ok: false, reason: 'De extractie heeft geen titel opgeleverd.' };
  }

  const description = asString(root.description);
  const baseServingsRaw = asNumberOrNull(root.base_servings);
  const baseServings =
    baseServingsRaw != null && baseServingsRaw > 0 ? Math.min(99, Math.round(baseServingsRaw)) : 4;

  const groupsIn = Array.isArray(root.ingredient_groups) ? root.ingredient_groups : [];
  const ingredientGroups: RecipeSavePayload['ingredientGroups'] = [];

  for (const g of groupsIn) {
    if (!isRecord(g)) continue;
    const gTitle = asString(g.title);
    const ingIn = Array.isArray(g.ingredients) ? g.ingredients : [];
    const ingredients: RecipeSavePayload['ingredientGroups'][0]['ingredients'] = [];
    for (const row of ingIn) {
      if (!isRecord(row)) continue;
      const name = (asString(row.name) ?? '').trim();
      if (!name) continue;
      ingredients.push({
        name,
        amount: asNumberOrNull(row.amount),
        unit: (asString(row.unit) ?? '').trim() || null,
      });
    }
    if (ingredients.length > 0) {
      ingredientGroups.push({
        title: (gTitle ?? '').trim(),
        ingredients,
      });
    }
  }

  if (ingredientGroups.length === 0) {
    return { ok: false, reason: 'Er zijn geen ingrediënten gevonden om te importeren.' };
  }

  const sectionsIn = Array.isArray(root.step_sections) ? root.step_sections : [];
  const stepSections: RecipeSavePayload['stepSections'] = [];

  for (const s of sectionsIn) {
    if (!isRecord(s)) continue;
    const sTitle = asString(s.title);
    const stepsIn = Array.isArray(s.steps) ? s.steps : [];
    const steps: RecipeSavePayload['stepSections'][0]['steps'] = [];
    for (const st of stepsIn) {
      if (!isRecord(st)) continue;
      const desc = (asString(st.description) ?? '').trim();
      if (!desc) continue;
      let timerSeconds = asIntOrNull(st.timer_seconds);
      if (timerSeconds != null && timerSeconds < 0) timerSeconds = null;
      steps.push({ description: desc, timerSeconds });
    }
    if (steps.length > 0) {
      stepSections.push({
        title: (sTitle ?? '').trim(),
        steps,
      });
    }
  }

  if (stepSections.length === 0) {
    return { ok: false, reason: 'Er zijn geen bereidingsstappen gevonden om te importeren.' };
  }

  const tagsIn = Array.isArray(root.tags) ? root.tags : [];
  const sanitizedTags = sanitizeImportedRecipeTags(
    tagsIn.map((t) => (typeof t === 'string' ? t.trim() : '')).filter(Boolean)
  );
  const { dietVegetarian, dietVegan, dietKeto, tagNames } = extractDietFromTags(sanitizedTags);

  const payload: RecipeSavePayload = {
    title,
    description: (description ?? '').trim(),
    sourceUrl: sourceUrl.trim(),
    baseServings,
    prepTimeMin: asIntOrNull(root.prep_time_min),
    cookTimeMin: asIntOrNull(root.cook_time_min),
    totalTimeMin: asIntOrNull(root.total_time_min),
    category: (asString(root.category) ?? '').trim(),
    dietVegetarian,
    dietVegan,
    dietKeto,
    isFavorite: false,
    wantToTry: false,
    notes: '',
    imageUri: '',
    tagNames,
    ingredientGroups,
    stepSections,
  };

  return { ok: true, payload };
}

export type ExtractResult =
  | { ok: true; payload: RecipeSavePayload }
  | { ok: false; message: string; rawModelText?: string; debugSnippet?: string };

function isAhAllerhandeUrl(url: string): boolean {
  try {
    const u = new URL(url.trim());
    const h = u.hostname.toLowerCase();
    return h === 'www.ah.nl' || h === 'ah.nl' || h.endsWith('.ah.nl') || h === 'allerhande.nl' || h.endsWith('.allerhande.nl');
  } catch {
    return false;
  }
}

function collectRecipeJsonLdObjects(root: unknown): unknown[] {
  const out: unknown[] = [];
  const visit = (node: unknown) => {
    if (node == null) return;
    if (Array.isArray(node)) {
      for (const x of node) visit(x);
      return;
    }
    if (typeof node !== 'object') return;
    const rec = node as Record<string, unknown>;
    const t = rec['@type'];
    const isRecipe =
      t === 'Recipe' ||
      (Array.isArray(t) && t.some((x) => x === 'Recipe')) ||
      (typeof t === 'string' && t.toLowerCase() === 'recipe');
    if (isRecipe) out.push(node);
    const graph = rec['@graph'];
    if (graph) visit(graph);
  };
  visit(root);
  return out;
}

function extractRecipeJsonLdOnlyFromScripts(jsonLdScripts: string[]): string[] {
  const recipes: unknown[] = [];

  const coerceToFirstJsonValue = (raw: string): unknown | null => {
    const s = raw.trim();
    if (!s) return null;
    try {
      return JSON.parse(s) as unknown;
    } catch {
      // Try to salvage a single JSON object/array from messy script contents.
      const startObj = s.indexOf('{');
      const startArr = s.indexOf('[');
      const start =
        startObj === -1 ? startArr : startArr === -1 ? startObj : Math.min(startObj, startArr);
      if (start === -1) return null;
      const open = s[start];
      const close = open === '{' ? '}' : ']';
      let depth = 0;
      let inStr = false;
      let esc = false;
      for (let i = start; i < s.length; i++) {
        const c = s[i];
        if (inStr) {
          if (esc) esc = false;
          else if (c === '\\') esc = true;
          else if (c === '"') inStr = false;
          continue;
        }
        if (c === '"') {
          inStr = true;
          continue;
        }
        if (c === open) depth++;
        else if (c === close) {
          depth--;
          if (depth === 0) {
            const candidate = s.slice(start, i + 1);
            try {
              return JSON.parse(candidate) as unknown;
            } catch {
              return null;
            }
          }
        }
      }
      return null;
    }
  };

  for (const s of jsonLdScripts) {
    const t = s.trim();
    if (!t) continue;
    try {
      const parsed = coerceToFirstJsonValue(t);
      if (parsed == null) continue;
      const found = collectRecipeJsonLdObjects(parsed);
      for (const r of found) recipes.push(r);
    } catch {
      // Ignore parse errors; we'll fall back to raw JSON-LD scripts.
    }
  }
  if (recipes.length === 0) return [];

  const asString = (x: unknown): string | null => (typeof x === 'string' ? x : null);
  const asStringArray = (x: unknown): string[] => {
    if (typeof x === 'string') return [x];
    if (Array.isArray(x)) return x.map((v) => (typeof v === 'string' ? v : '')).filter(Boolean);
    return [];
  };
  const isRecord = (x: unknown): x is Record<string, unknown> =>
    x != null && typeof x === 'object' && !Array.isArray(x);

  const normalizeInstructions = (x: unknown): string[] => {
    const out: string[] = [];
    const pushText = (t: string | null) => {
      const s = (t ?? '').trim();
      if (s) out.push(s);
    };

    const visit = (node: unknown) => {
      if (node == null) return;
      if (typeof node === 'string') {
        pushText(node);
        return;
      }
      if (Array.isArray(node)) {
        for (const v of node) visit(v);
        return;
      }
      if (!isRecord(node)) return;
      // schema.org structures: HowToStep/HowToSection/ItemList, etc.
      pushText(asString(node.text));
      pushText(asString(node.name));
      if (node.itemListElement) visit(node.itemListElement);
      if (node.steps) visit(node.steps);
      if (node.step) visit(node.step);
      if (node.itemListElements) visit(node.itemListElements);
      if (node.elements) visit(node.elements);
    };

    visit(x);
    return out;
  };

  const minimal = recipes
    .filter(isRecord)
    .map((r) => {
      const m: Record<string, unknown> = {};

      // Keep only fields that help extraction; drop huge metadata (ratings/reviews/nutrition/publisher graphs).
      m['@type'] = 'Recipe';
      const name = asString(r.name) ?? asString(r.headline) ?? null;
      if (name) m.name = name;
      const description = asString(r.description) ?? null;
      if (description) m.description = description;

      const ingredients = asStringArray(r.recipeIngredient);
      if (ingredients.length > 0) m.recipeIngredient = ingredients;

      const instructions = normalizeInstructions(r.recipeInstructions);
      if (instructions.length > 0) m.recipeInstructions = instructions;

      const yieldVal = r.recipeYield;
      if (typeof yieldVal === 'string' || typeof yieldVal === 'number' || Array.isArray(yieldVal)) {
        m.recipeYield = yieldVal;
      }

      const prepTime = asString(r.prepTime);
      const cookTime = asString(r.cookTime);
      const totalTime = asString(r.totalTime);
      if (prepTime) m.prepTime = prepTime;
      if (cookTime) m.cookTime = cookTime;
      if (totalTime) m.totalTime = totalTime;

      const category = r.recipeCategory;
      if (typeof category === 'string' || Array.isArray(category)) m.recipeCategory = category;

      const keywords = r.keywords;
      if (typeof keywords === 'string' || Array.isArray(keywords)) m.keywords = keywords;

      return m;
    })
    .filter((r) => Object.keys(r).length > 1);

  // Keep compact to save tokens.
  return [JSON.stringify(minimal.length > 0 ? minimal : recipes)];
}

function clipHtmlForModel(filtered: string): string {
  const maxChars = filtered.startsWith(JSON_LD_BLOCKS_MARKER) ? MAX_JSONLD_ONLY_CHARS : MAX_HTML_CHARS;
  if (filtered.length <= maxChars) return filtered;
  const i = filtered.indexOf(JSON_LD_BLOCKS_MARKER);
  if (i === -1) {
    return `${filtered.slice(0, maxChars)}\n\n<!-- HTML ingekort -->`;
  }
  const htmlPart = filtered.slice(0, i);
  const ldTail = filtered.slice(i);
  const budget = maxChars - ldTail.length - 80;
  if (budget < 500) {
    return `${filtered.slice(0, maxChars)}\n\n<!-- HTML + JSON-LD ingekort -->`;
  }
  const clippedMain =
    htmlPart.length <= budget
      ? htmlPart
      : `${htmlPart.slice(0, budget)}\n\n<!-- HTML ingekort; JSON-LD hieronder volledig -->`;
  return clippedMain + ldTail;
}

export async function extractRecipeFromPageHtml(
  html: string,
  sourceUrl: string
): Promise<ExtractResult> {
  // Allerhande/AH pages usually contain full schema.org/Recipe JSON-LD.
  // To cut tokens hard (esp. when importing multiple recipes quickly), prefer sending only JSON-LD if present.
  const jsonLdChunks = extractApplicationLdJsonScripts(html);
  const preferJsonLdOnly = isAhAllerhandeUrl(sourceUrl) && jsonLdChunks.length > 0;

  const recipeOnly = preferJsonLdOnly ? extractRecipeJsonLdOnlyFromScripts(jsonLdChunks) : [];
  const filtered =
    preferJsonLdOnly && recipeOnly.length > 0
      ? `${JSON_LD_BLOCKS_MARKER}${recipeOnly.join('\n---JSONLD---\n')}`
      : filterRecipePageHtml(html);
  const clipped = clipHtmlForModel(filtered);

  const debug =
    `debug_chars: filtered=${filtered.length} clipped=${clipped.length}` +
    (preferJsonLdOnly
      ? ` jsonld_scripts=${jsonLdChunks.length} recipe_only=${recipeOnly.length > 0}`
      : '');
  const user = `Bron-URL: ${sourceUrl}\n${debug}\n\nHTML:\n\n${clipped}`;

  const ai = await callAiText({
    system: EXTRACT_SYSTEM_PROMPT,
    user,
    maxTokens: 8192,
  });

  if (!ai.ok) {
    return {
      ok: false,
      message: ai.message,
      debugSnippet: ai.debugSnippet,
    };
  }

  const parsed = parseExtractedRecipeJson(ai.text, sourceUrl);
  if (!parsed.ok) {
    // One repair attempt: send the model its own output + validation errors.
    const repairUser = buildAiRepairUserPrompt({
      purpose: 'recipeExtract',
      outputSchema: RECIPE_JSON_SCHEMA,
      previousOutput: ai.text,
      validationErrors: [parsed.reason],
    });
    const repaired = await callAiText({
      system: EXTRACT_SYSTEM_PROMPT,
      user: repairUser,
      maxTokens: 8192,
    });
    if (!repaired.ok) {
      return { ok: false, message: parsed.reason, rawModelText: ai.text, debugSnippet: repaired.debugSnippet };
    }
    const parsed2 = parseExtractedRecipeJson(repaired.text, sourceUrl);
    if (!parsed2.ok) {
      return { ok: false, message: parsed2.reason, rawModelText: repaired.text };
    }
    return { ok: true, payload: parsed2.payload };
  }

  return { ok: true, payload: parsed.payload };
}
