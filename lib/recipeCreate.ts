import { callAiChat, callAiText, type AiChatTurn } from './aiClient';
import type { AiLanguage } from './aiLanguage';
import { formatAiCookProfileForPrompt } from './aiCookProfile';
import { buildAiRepairUserPrompt, RECIPE_JSON_SCHEMA } from './aiPromptTemplates';
import { parseExtractedRecipeJson } from './recipeExtract';
import type { RecipeAdjustResult } from './recipeAdjust';
import type { RecipeSavePayload } from './types';

/** Max messages sent on “apply” to cap tokens. */
const MAX_CREATE_CHAT_MESSAGES = 14;

/** System prompt voor de chat waarin een NIEUW recept samen wordt bedacht. */
export function buildCreateChatSystemPrompt(lang: AiLanguage = 'nl'): string {
  void lang; // EN-variant: zie ai-taalfase
  const profile = formatAiCookProfileForPrompt('adjustRecipe');
  return `Je bent een ervaren kookassistent die samen met de thuiskok een NIEUW recept bedenkt.

Richtlijnen:
- Bespreek kort en concreet in het Nederlands welk recept je voorstelt (gerecht, keuken, hoofdingrediënten).
- Stel gerust één verdiepende vraag als het verzoek onduidelijk is (dieet, snelheid, keuken, gelegenheid).
- Doe een concreet voorstel: ingrediënten met hoeveelheden, genummerde bereidingsstappen, tijden en evt. een timer per stap.
- Houd antwoorden kort en praktisch — geen lange verhalen.
- Als de gebruiker akkoord gaat of iets wil bijstellen, bevestig dan kort wat je gaat doorvoeren.

${profile ? `${profile}\n` : ''}`;
}

/** System prompt voor de laatste stap: chatgeschiedenis → volledig nieuw recept als JSON. */
export function buildApplyCreateFromChatSystemPrompt(lang: AiLanguage = 'nl'): string {
  void lang; // EN-variant: zie ai-taalfase
  const profile = formatAiCookProfileForPrompt('adjustRecipe');
  return `Je bent een kookassistent. Je hebt zojuist samen met de gebruiker een nieuw recept bedacht.
Geef nu het VOLLEDIGE recept terug als pure JSON, exact volgens het schema hieronder.
Voer alle besproken keuzes door. Geen markdown, geen uitleg — alleen de JSON.

${profile ? `${profile}\n\n` : ''}Schema:
${RECIPE_JSON_SCHEMA}`;
}

/**
 * Velden die nooit door AI bij een nieuw recept worden ingevuld:
 * bron/foto/notities/status worden door de gebruiker zelf beheerd, bio-score wordt apart berekend.
 */
export function stripDraftOnlyFields(parsed: RecipeSavePayload): RecipeSavePayload {
  return {
    ...parsed,
    sourceUrl: '',
    isFavorite: false,
    wantToTry: false,
    bioScoreColor: null,
    bioScoreUpdatedAt: null,
    bioScoreItems: null,
    notes: '',
    imageUri: '',
  };
}

/**
 * Takes the conversation history from the create chat and produces a full new
 * recipe by asking the AI to output structured JSON (with one repair attempt).
 */
export async function applyRecipeFromChat(chatHistory: AiChatTurn[]): Promise<RecipeAdjustResult> {
  if (chatHistory.length === 0) {
    return { ok: false, message: 'Geen bespreking om toe te passen.' };
  }

  const trimmedHistory =
    chatHistory.length > MAX_CREATE_CHAT_MESSAGES
      ? chatHistory.slice(-MAX_CREATE_CHAT_MESSAGES)
      : chatHistory;

  const applyMessage: AiChatTurn = {
    role: 'user',
    text: `Top, zet het besproken recept nu om. Geef het VOLLEDIGE recept terug als JSON (alleen JSON, geen markdown, geen uitleg). Gebruik dit schema:\n${RECIPE_JSON_SCHEMA}`,
  };

  const systemPrompt = buildApplyCreateFromChatSystemPrompt();

  const res = await callAiChat({
    system: systemPrompt,
    messages: [...trimmedHistory, applyMessage],
    maxTokens: 8192,
    task: 'adjust',
  });

  if (!res.ok) {
    return { ok: false, message: res.message };
  }

  let parsed = parseExtractedRecipeJson(res.text, '');
  if (!parsed.ok) {
    const repairUser = buildAiRepairUserPrompt({
      purpose: 'adjustRecipe',
      outputSchema: RECIPE_JSON_SCHEMA,
      previousOutput: res.text,
      validationErrors: [parsed.reason],
    });
    const repaired = await callAiText({
      system: systemPrompt,
      user: repairUser,
      maxTokens: 8192,
      task: 'adjust',
    });
    if (!repaired.ok) {
      return { ok: false, message: parsed.reason, raw: res.text };
    }
    parsed = parseExtractedRecipeJson(repaired.text, '');
    if (!parsed.ok) {
      return { ok: false, message: parsed.reason, raw: repaired.text };
    }
  }

  return { ok: true, payload: stripDraftOnlyFields(parsed.payload) };
}
