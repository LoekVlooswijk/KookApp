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
  const profile = formatAiCookProfileForPrompt('adjustRecipe', lang);
  const intro =
    lang === 'en'
      ? 'You are an experienced cooking assistant devising a NEW recipe together with the home cook.'
      : 'Je bent een ervaren kookassistent die samen met de thuiskok een NIEUW recept bedenkt.';
  const guidelines =
    lang === 'en'
      ? `Guidelines:
- Discuss briefly and concretely in English which recipe you propose (dish, cuisine, key ingredients).
- Feel free to ask one clarifying question if the request is unclear (diet, speed, cuisine, occasion).
- Make a concrete proposal: ingredients with quantities, numbered method steps, timings and possibly a timer per step.
- Keep answers short and practical — no long stories.
- If the user agrees or wants to tweak something, briefly confirm what you will apply.`
      : `Richtlijnen:
- Bespreek kort en concreet in het Nederlands welk recept je voorstelt (gerecht, keuken, hoofdingrediënten).
- Stel gerust één verdiepende vraag als het verzoek onduidelijk is (dieet, snelheid, keuken, gelegenheid).
- Doe een concreet voorstel: ingrediënten met hoeveelheden, genummerde bereidingsstappen, tijden en evt. een timer per stap.
- Houd antwoorden kort en praktisch — geen lange verhalen.
- Als de gebruiker akkoord gaat of iets wil bijstellen, bevestig dan kort wat je gaat doorvoeren.`;

  return `${intro}

${guidelines}

${profile ? `${profile}\n` : ''}`;
}

/** System prompt voor de laatste stap: chatgeschiedenis → volledig nieuw recept als JSON. */
export function buildApplyCreateFromChatSystemPrompt(lang: AiLanguage = 'nl'): string {
  const profile = formatAiCookProfileForPrompt('adjustRecipe', lang);
  const intro =
    lang === 'en'
      ? `You are a cooking assistant. You have just devised a new recipe together with the user.
Now return the COMPLETE recipe as pure JSON, exactly matching the schema below.
Apply all the choices discussed. No markdown, no explanation — only the JSON.`
      : `Je bent een kookassistent. Je hebt zojuist samen met de gebruiker een nieuw recept bedacht.
Geef nu het VOLLEDIGE recept terug als pure JSON, exact volgens het schema hieronder.
Voer alle besproken keuzes door. Geen markdown, geen uitleg — alleen de JSON.`;

  return `${intro}

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
export async function applyRecipeFromChat(
  chatHistory: AiChatTurn[],
  lang: AiLanguage = 'nl'
): Promise<RecipeAdjustResult> {
  if (chatHistory.length === 0) {
    return {
      ok: false,
      message:
        lang === 'en' ? 'There is no discussion to apply.' : 'Geen bespreking om toe te passen.',
    };
  }

  const trimmedHistory =
    chatHistory.length > MAX_CREATE_CHAT_MESSAGES
      ? chatHistory.slice(-MAX_CREATE_CHAT_MESSAGES)
      : chatHistory;

  const applyMessage: AiChatTurn = {
    role: 'user',
    text:
      lang === 'en'
        ? `Great, turn the recipe we discussed into a final draft now. Return the COMPLETE recipe as JSON (only JSON, no markdown, no explanation). Use this schema:\n${RECIPE_JSON_SCHEMA}`
        : `Top, zet het besproken recept nu om. Geef het VOLLEDIGE recept terug als JSON (alleen JSON, geen markdown, geen uitleg). Gebruik dit schema:\n${RECIPE_JSON_SCHEMA}`,
  };

  const systemPrompt = buildApplyCreateFromChatSystemPrompt(lang);

  const res = await callAiChat({
    system: systemPrompt,
    messages: [...trimmedHistory, applyMessage],
    maxTokens: 8192,
    task: 'adjust',
  });

  if (!res.ok) {
    return { ok: false, message: res.message };
  }

  let parsed = parseExtractedRecipeJson(res.text, '', lang);
  if (!parsed.ok) {
    const repairUser = buildAiRepairUserPrompt({
      purpose: 'adjustRecipe',
      outputSchema: RECIPE_JSON_SCHEMA,
      previousOutput: res.text,
      validationErrors: [parsed.reason],
      lang,
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
    parsed = parseExtractedRecipeJson(repaired.text, '', lang);
    if (!parsed.ok) {
      return { ok: false, message: parsed.reason, raw: repaired.text };
    }
  }

  return { ok: true, payload: stripDraftOnlyFields(parsed.payload) };
}
