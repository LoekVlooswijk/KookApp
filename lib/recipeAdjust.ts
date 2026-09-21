import { callAiChat, callAiText, type AiChatTurn } from './aiClient';

/** Max messages sent on “apply” to cap tokens (full recipe is still in system prompt). */
const MAX_ADJUST_CHAT_MESSAGES = 14;
import { formatAiCookProfileForPrompt } from './aiCookProfile';
import {
  buildAiRepairUserPrompt,
  buildRecipeAdjustSystemPrompt,
  RECIPE_JSON_SCHEMA,
} from './aiPromptTemplates';
import { fullRecipeToExtractShape } from './recipeAdjustShape';
import { formatStepTimerNl } from './timerFormat';
import { parseExtractedRecipeJson } from './recipeExtract';
import type { FullRecipe, RecipeSavePayload } from './types';

function buildAdjustSystemPrompt(): string {
  // The prompt builder already includes cook profile + priority rules.
  // Keep this wrapper to avoid touching all call sites.
  return buildRecipeAdjustSystemPrompt();
}

function recipeToReadableText(recipe: FullRecipe): string {
  const lines: string[] = [];
  lines.push(`Titel: ${recipe.title}`);
  if (recipe.description?.trim()) lines.push(`Beschrijving: ${recipe.description.trim()}`);
  if (recipe.category?.trim()) lines.push(`Categorie: ${recipe.category.trim()}`);
  lines.push(`Porties: ${recipe.baseServings ?? '?'}`);
  const times: string[] = [];
  if (recipe.prepTimeMin != null) times.push(`voorbereiding ${recipe.prepTimeMin} min`);
  if (recipe.cookTimeMin != null) times.push(`koken ${recipe.cookTimeMin} min`);
  if (recipe.totalTimeMin != null) times.push(`totaal ${recipe.totalTimeMin} min`);
  if (times.length) lines.push(`Tijden: ${times.join(', ')}`);
  if (recipe.tags.length > 0) lines.push(`Tags: ${recipe.tags.join(', ')}`);

  lines.push('');
  lines.push('INGREDIËNTEN');
  for (const g of recipe.ingredientGroups) {
    if (g.title?.trim()) lines.push(`[${g.title.trim()}]`);
    for (const i of g.ingredients) {
      const qty = [i.amount != null ? String(i.amount) : '', i.unit?.trim() ?? '']
        .filter(Boolean)
        .join(' ');
      lines.push(qty ? `- ${qty} ${i.name}` : `- ${i.name}`);
    }
  }

  lines.push('');
  lines.push('BEREIDINGSSTAPPEN');
  let stepNum = 1;
  for (const s of recipe.stepSections) {
    if (s.title?.trim()) lines.push(`[${s.title.trim()}]`);
    for (const st of s.steps) {
      const timer =
        st.timerSeconds != null && st.timerSeconds > 0
          ? ` (timer: ${formatStepTimerNl(st.timerSeconds)})`
          : '';
      lines.push(`${stepNum}. ${st.description}${timer}`);
      stepNum++;
    }
  }
  return lines.join('\n');
}

export function buildAdjustChatSystemPrompt(recipe: FullRecipe): string {
  const profile = formatAiCookProfileForPrompt('adjustRecipe');
  return `Je bent een ervaren kookassistent die helpt recepten te verbeteren.
Je bekijkt samen met de thuiskok het volgende recept:

${recipeToReadableText(recipe)}

${profile ? `\n${profile}\n` : ''}
Richtlijnen:
- Bespreek voorgestelde aanpassingen kort en concreet in het Nederlands.
- Je mag alles aanpassen: ingrediënten, hoeveelheden, bereidingsstappen, timers, tijden, beschrijving, tags.
- Neem creatieve vrijheid: stel gerust ook gerelateerde verbeteringen voor (betere kruiden, handiger bereidingswijze, stappen samenvoegen of toevoegen) als dat past bij wat de gebruiker wil.
- Verwijs naar specifieke stappen op nummer als je die wilt wijzigen.
- Geef een duidelijk overzicht van wat je zou veranderen en waarom.
- Houd antwoorden kort en praktisch — geen lange verhalen.
- Als de gebruiker akkoord gaat, bevestig dan welke aanpassingen je doorvoert.`;
}

/** Behoud bron-URL, favorieten, bio-score, eigen notities en afbeelding; AI levert alleen receptvelden. */
export function mergeAdjustedPayload(
  original: FullRecipe,
  parsed: RecipeSavePayload
): RecipeSavePayload {
  return {
    ...parsed,
    sourceUrl: (original.sourceUrl ?? '').trim() || parsed.sourceUrl,
    isFavorite: original.isFavorite,
    wantToTry: original.wantToTry,
    bioScoreColor: original.bioScoreColor ?? null,
    bioScoreUpdatedAt: original.bioScoreUpdatedAt ?? null,
    bioScoreItems: original.bioScoreItems ?? null,
    notes: original.notes ?? '',
    imageUri: original.imageUri ?? '',
  };
}

export type RecipeAdjustResult =
  { ok: true; payload: RecipeSavePayload } | { ok: false; message: string; raw?: string };

export async function requestRecipeAdjustment(
  recipe: FullRecipe,
  userNote: string
): Promise<RecipeAdjustResult> {
  const note = userNote.trim();
  if (!note) {
    return { ok: false, message: 'Schrijf eerst een korte notitie.' };
  }

  const shape = fullRecipeToExtractShape(recipe);
  const userBlock = `Huidige recept (JSON):\n${JSON.stringify(shape)}\n\nNotitie van de gebruiker:\n${note}`;

  const res = await callAiText({
    system: buildAdjustSystemPrompt(),
    user: userBlock,
    maxTokens: 8192,
    task: 'adjust',
  });

  if (!res.ok) {
    return { ok: false, message: res.message, raw: res.debugSnippet };
  }

  const parsed = parseExtractedRecipeJson(res.text, recipe.sourceUrl ?? '');
  if (!parsed.ok) {
    // One repair attempt: give the model the schema + its own output + the parse failure reason.
    const repairUser = buildAiRepairUserPrompt({
      purpose: 'adjustRecipe',
      outputSchema: RECIPE_JSON_SCHEMA,
      previousOutput: res.text,
      validationErrors: [parsed.reason],
    });
    const repaired = await callAiText({
      system: buildAdjustSystemPrompt(),
      user: repairUser,
      maxTokens: 8192,
      task: 'adjust',
    });
    if (!repaired.ok) {
      return { ok: false, message: parsed.reason, raw: res.text };
    }
    const parsed2 = parseExtractedRecipeJson(repaired.text, recipe.sourceUrl ?? '');
    if (!parsed2.ok) {
      return { ok: false, message: parsed2.reason, raw: repaired.text };
    }
    return { ok: true, payload: mergeAdjustedPayload(recipe, parsed2.payload) };
  }

  return { ok: true, payload: mergeAdjustedPayload(recipe, parsed.payload) };
}

/**
 * Takes the conversation history from the adjust chat and produces a final
 * adjusted recipe by asking the AI to output structured JSON.
 */
/** System prompt voor de laatste stap: chatgeschiedenis + huidig recept → JSON. */
export function buildApplyAdjustmentFromChatSystemPrompt(recipe: FullRecipe): string {
  const shape = fullRecipeToExtractShape(recipe);
  const profile = formatAiCookProfileForPrompt('adjustRecipe');
  return `Je bent een kookassistent. Je hebt zojuist aanpassingen aan een recept besproken met de gebruiker.
Nu moet je het volledige aangepaste recept teruggeven als pure JSON, exact volgens het opgegeven schema.
Voer alle besproken wijzigingen door. Geen markdown, geen uitleg — alleen de JSON.

${profile ? `${profile}\n\n` : ''}Huidig recept:
${JSON.stringify(shape)}`;
}

export async function applyAdjustmentFromChat(
  recipe: FullRecipe,
  chatHistory: AiChatTurn[]
): Promise<RecipeAdjustResult> {
  if (chatHistory.length === 0) {
    return { ok: false, message: 'Geen bespreking om toe te passen.' };
  }

  const trimmedHistory =
    chatHistory.length > MAX_ADJUST_CHAT_MESSAGES
      ? chatHistory.slice(-MAX_ADJUST_CHAT_MESSAGES)
      : chatHistory;

  const applyMessage: AiChatTurn = {
    role: 'user',
    text: `Top, voer de besproken aanpassingen nu door. Geef het VOLLEDIGE aangepaste recept terug als JSON (alleen JSON, geen markdown, geen uitleg). Gebruik dit schema:\n${RECIPE_JSON_SCHEMA}`,
  };

  const systemPrompt = buildApplyAdjustmentFromChatSystemPrompt(recipe);

  const messages = [...trimmedHistory, applyMessage];

  const res = await callAiChat({
    system: systemPrompt,
    messages,
    maxTokens: 8192,
    task: 'adjust',
  });

  if (!res.ok) {
    return { ok: false, message: res.message };
  }

  let parsed = parseExtractedRecipeJson(res.text, recipe.sourceUrl ?? '');
  if (!parsed.ok) {
    const repairUser = buildAiRepairUserPrompt({
      purpose: 'adjustRecipe',
      outputSchema: RECIPE_JSON_SCHEMA,
      previousOutput: res.text,
      validationErrors: [parsed.reason],
    });
    const repaired = await callAiText({
      system: buildAdjustSystemPrompt(),
      user: repairUser,
      maxTokens: 8192,
      task: 'adjust',
    });
    if (!repaired.ok) {
      return { ok: false, message: parsed.reason, raw: res.text };
    }
    parsed = parseExtractedRecipeJson(repaired.text, recipe.sourceUrl ?? '');
    if (!parsed.ok) {
      return { ok: false, message: parsed.reason, raw: repaired.text };
    }
  }

  return { ok: true, payload: mergeAdjustedPayload(recipe, parsed.payload) };
}
