import { callAiText } from './aiClient';
import { buildAiRepairUserPrompt, buildRecipeExtractSystemPrompt, RECIPE_JSON_SCHEMA } from './aiPromptTemplates';
import { filterRecipePageHtml, JSON_LD_BLOCKS_MARKER } from './recipePageHtmlFilter';
import { extractDietFromTags, sanitizeImportedRecipeTags } from './recipeTagSanitize';
import type { RecipeSavePayload } from './types';

export const MAX_HTML_CHARS = 120_000;

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

function clipHtmlForModel(filtered: string): string {
  if (filtered.length <= MAX_HTML_CHARS) return filtered;
  const i = filtered.indexOf(JSON_LD_BLOCKS_MARKER);
  if (i === -1) {
    return `${filtered.slice(0, MAX_HTML_CHARS)}\n\n<!-- HTML ingekort -->`;
  }
  const htmlPart = filtered.slice(0, i);
  const ldTail = filtered.slice(i);
  const budget = MAX_HTML_CHARS - ldTail.length - 80;
  if (budget < 500) {
    return `${filtered.slice(0, MAX_HTML_CHARS)}\n\n<!-- HTML + JSON-LD ingekort -->`;
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
  const filtered = filterRecipePageHtml(html);
  const clipped = clipHtmlForModel(filtered);

  const user = `Bron-URL: ${sourceUrl}\n\nHTML:\n\n${clipped}`;

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
