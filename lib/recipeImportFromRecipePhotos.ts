import type { AiImageMediaType } from './aiClient';
import { callAiText, callAiWithImageText } from './aiClient';
import type { AiLanguage } from './aiLanguage';
import {
  buildAiRepairUserPrompt,
  buildRecipeExtractFromOcrTextSystemPrompt,
  buildRecipePhotoOcrSystemPrompt,
  RECIPE_JSON_SCHEMA,
} from './aiPromptTemplates';
import { parseExtractedRecipeJson } from './recipeExtract';
import type { RecipeSavePayload } from './types';

/** Privacy/token guard: batch OCR + extract in one prompt. */
export const MAX_RECIPE_IMPORT_PHOTOS = 8;

export type RecipePhotoInput = {
  base64: string;
  mediaType: AiImageMediaType;
};

export type RecipePhotoOcrResult =
  { ok: true; text: string } | { ok: false; message: string; rawModelText?: string };

export async function transcribeRecipePhoto(params: {
  photo: RecipePhotoInput;
  hintText?: string;
  lang?: AiLanguage;
}): Promise<RecipePhotoOcrResult> {
  const lang = params.lang ?? 'nl';
  const system = buildRecipePhotoOcrSystemPrompt(lang);
  const hint = (params.hintText ?? '').trim();
  const userText =
    (lang === 'en'
      ? 'Transcribe the recipe text as plain text (no JSON).'
      : 'Schrijf de recepttekst over als plain text (geen JSON).') +
    (hint
      ? `\n\n${lang === 'en' ? `Extra hint from the user: ${hint}` : `Extra hint van gebruiker: ${hint}`}`
      : '');

  const res = await callAiWithImageText({
    system,
    userText,
    imageBase64: params.photo.base64,
    imageMediaType: params.photo.mediaType,
    maxTokens: 4096,
    task: 'import',
  });
  if (!res.ok) {
    return { ok: false, message: res.message, rawModelText: res.debugSnippet };
  }
  const text = (res.text ?? '').trim();
  if (!text) {
    return {
      ok: false,
      message:
        lang === 'en'
          ? 'Could not read any text from the photo. Try a sharper photo with better light.'
          : 'Kon geen tekst uit de foto lezen. Probeer een scherpere foto met beter licht.',
    };
  }
  return { ok: true, text };
}

export type ExtractFromRecipePhotosResult =
  | { ok: true; payload: RecipeSavePayload; ocrTexts: string[] }
  | { ok: false; message: string; rawModelText?: string; ocrTexts?: string[] };

function buildCombinedOcrUserText(params: { ocrTexts: string[]; hintText?: string }): string {
  const hint = (params.hintText ?? '').trim();
  const blocks = params.ocrTexts.map((t, i) => `PAGE_${i + 1}_TEXT:\n${t.trim()}`).filter(Boolean);
  return [
    'PURPOSE: recipeExtractFromOcrText',
    hint ? `USER_HINT:\n${hint}` : null,
    'OCR_TEXTS:',
    ...blocks,
  ]
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .join('\n\n')
    .trim();
}

async function extractRecipeFromOcrTextOnce(params: {
  combinedUserText: string;
  lang: AiLanguage;
}): Promise<
  { ok: true; payload: RecipeSavePayload } | { ok: false; message: string; rawModelText?: string }
> {
  const system = buildRecipeExtractFromOcrTextSystemPrompt(params.lang);
  const ai = await callAiText({
    system,
    user: params.combinedUserText,
    maxTokens: 8192,
    task: 'import',
  });
  if (!ai.ok) return { ok: false, message: ai.message, rawModelText: ai.debugSnippet };

  const parsed = parseExtractedRecipeJson(ai.text, '', params.lang);
  if (!parsed.ok) {
    // One repair attempt: send validation errors + schema + previous output.
    const repairUser = buildAiRepairUserPrompt({
      purpose: 'recipeExtract',
      outputSchema: RECIPE_JSON_SCHEMA,
      previousOutput: ai.text,
      validationErrors: [parsed.reason],
      lang: params.lang,
    });
    const repaired = await callAiText({
      system,
      user: repairUser,
      maxTokens: 8192,
      task: 'import',
    });
    if (!repaired.ok) {
      return { ok: false, message: parsed.reason, rawModelText: ai.text };
    }
    const parsed2 = parseExtractedRecipeJson(repaired.text, '', params.lang);
    if (!parsed2.ok) {
      return { ok: false, message: parsed2.reason, rawModelText: repaired.text };
    }
    return { ok: true, payload: parsed2.payload };
  }
  return { ok: true, payload: parsed.payload };
}

export async function extractRecipeFromRecipePhotos(params: {
  photos: RecipePhotoInput[];
  hintText?: string;
  lang?: AiLanguage;
  onProgress?: (
    p: { phase: 'ocr'; photoIndex: number; totalPhotos: number } | { phase: 'extract' }
  ) => void;
}): Promise<ExtractFromRecipePhotosResult> {
  const lang = params.lang ?? 'nl';
  const photos = Array.isArray(params.photos) ? params.photos : [];
  if (photos.length === 0) {
    return {
      ok: false,
      message:
        lang === 'en' ? 'Please pick one or more photos first.' : 'Kies eerst één of meer foto’s.',
    };
  }
  if (photos.length > MAX_RECIPE_IMPORT_PHOTOS) {
    return {
      ok: false,
      message:
        lang === 'en'
          ? `You can pick up to ${MAX_RECIPE_IMPORT_PHOTOS} photos at a time (privacy and token limit).`
          : `Je kunt maximaal ${MAX_RECIPE_IMPORT_PHOTOS} foto’s tegelijk kiezen (privacy en tokenlimiet).`,
    };
  }

  const ocrTexts: string[] = [];
  for (let i = 0; i < photos.length; i++) {
    params.onProgress?.({ phase: 'ocr', photoIndex: i, totalPhotos: photos.length });
    const photo = photos[i];
    if (!photo?.base64?.trim()) continue;
    const ocr = await transcribeRecipePhoto({ photo, hintText: params.hintText, lang });
    if (!ocr.ok) {
      return { ok: false, message: ocr.message, rawModelText: ocr.rawModelText, ocrTexts };
    }
    ocrTexts.push(ocr.text);
  }

  if (ocrTexts.length === 0) {
    return {
      ok: false,
      message:
        lang === 'en'
          ? 'Could not read any text from the photos. Try sharper photos.'
          : 'Kon geen tekst uit de foto’s lezen. Probeer scherpere foto’s.',
    };
  }

  params.onProgress?.({ phase: 'extract' });
  const combinedUserText = buildCombinedOcrUserText({ ocrTexts, hintText: params.hintText });
  const extracted = await extractRecipeFromOcrTextOnce({ combinedUserText, lang });
  if (!extracted.ok) {
    return {
      ok: false,
      message: extracted.message,
      rawModelText: extracted.rawModelText,
      ocrTexts,
    };
  }

  // Ensure no source URL, since it came from photos.
  return { ok: true, payload: { ...extracted.payload, sourceUrl: '', imageUri: '' }, ocrTexts };
}
