import {
  callAiText,
  callAiTextWithWebSearch,
  callAiWithImageText,
  type AiImageMediaType,
} from './aiClient';
import { getImportWebSearchEnabled } from './aiImportPrefs';
import { fetchRecipePageHtml } from './fetchRecipePage';
import { downloadRecipeCoverFromUrl } from './recipeCoverStorage';
import { coerceAnthropicJsonText, extractRecipeFromPageHtml, stripCodeFence } from './recipeExtract';
import { pickHeroImageUrlFromRecipeHtml } from './recipePageHeroImage';
import type { RecipeSavePayload } from './types';

const AH_URL_RULES = `Albert Heijn / Allerhande (belangrijk):
- Geldige recept-URL’s zien er zo uit: https://www.ah.nl/allerhande/recept/R-R<digits>/<slug> OF korte link https://www.ah.nl/r/<alleen cijfers>.
- Gebruik NOOIT https://www.ah.nl/recepten/<iets> — dat pad is geen receptpagina en levert meestal 404.
- Gebruik NOOIT https://www.ah.nl/allerhande/recepten/<categorie> — dat zijn overzichts-/themapagina’s, geen enkel recept.
- Zonder zichtbare URL of zonder bekend receptnummer: zet "url" op null en vul "zoekhint" (bijv. titel + "Albert Heijn allerhande").`;

/** System prompt: vision stap — recepten herkennen op een foto. */
export const DISCOVER_SYSTEM = `Je helpt bij het importeren van recepten uit een screenshot of foto.

Je ziet alleen de afbeelding (geen live web in deze stap). Liever "url": null dan een gegokte link.

Taak:
1. Herken alle recepten op de afbeelding (één groot recept, een scroll met meerdere, een lijstje met titels, een website met zichtbare URL, enz.).
2. Als er minstens één receptnaam of duidelijk gerecht op de foto staat: vul "recepten" met minstens één item. Liever één goed item dan een lege lijst.
3. Voor elk recept:
   - Als een URL letterlijk zichtbaar is (adresbalk, link, QR), gebruik die exact.
   - Anders zet "url" op null en vul "zoekhint" verplicht met een korte zoekregel die later op Google/het web gezocht kan worden (bv. exacte titel + "Albert Heijn recept", of "allerhande pasta rode pesto"). Zonder goede zoekhint kan de app het recept niet vinden.
   - Bij logo of huisstijl van Albert Heijn / Allerhande / AH: verwerk dat in "zoekhint" (bv. titel + "ah.nl allerhande recept").
   - Gok geen URL op basis van een titel-slug als je het URL-patroon niet zeker weet.

${AH_URL_RULES}

Andere Nederlandstalige sites: alleen url invullen als je het URL-patroon redelijk zeker weet; anders url null + zoekhint met titel + sitenaam.

Antwoord ALLEEN met één JSON-object (geen markdown), exact dit schema:
{
  "recepten": [
    {
      "titel": string,
      "url": string | null,
      "zoekhint": string | null,
      "toelichting": string
    }
  ]
}`;

/** System prompt: URL-resolutie zonder web search. */
export const RESOLVE_URLS_SYSTEM = `Je krijgt een JSON-lijst met recepttitels en per item een "zoekhint" (titel + context van de screenshot). Je hebt geen web search in deze modus: gebruik alleen URL’s die je uit training zeker weet.

Voor elk item: geef ÉÉN concrete https-URL naar een receptpagina, of url null als je het niet zeker weet. Liever null dan een URL die waarschijnlijk 404 is. Gebruik de zoekhint om te bepalen welke site het waarschijnlijk is, maar vul geen URL in als je die niet zeker kent.

${AH_URL_RULES}

Antwoord ALLEEN met JSON: {"recepten":[{"titel":"exact zelfde titel als input","url":"https:..." | null}]}
De volgorde en titels moeten overeenkomen met de input.`;

/** System prompt: URL-resolutie met web_search tool (indien ingeschakeld). */
export const RESOLVE_URLS_SYSTEM_WEB = `Je krijgt een JSON-lijst met recepttitels en per item een "zoekhint" om op het web te zoeken. Je hebt de tool web_search: gebruik die meerdere keren per recept tot je een echte receptpagina hebt (één URL per gerecht).

Prioriteit voor Nederland: Albert Heijn / Allerhande (ah.nl, allerhande). Zoek bv. op de zoekhint of op "<titel> site:ah.nl recept" als de hint AH/Allerhande suggereert. Andere sites: njam, 24kitchen, lekker en simpel, etc.

Na het zoeken: begin je antwoord direct met het teken "{" (geen inleidende zin). Alleen JSON:
{"recepten":[{"titel":"exact zelfde titel als input","url":"https:..." | null}]}

Voor elk item precies één URL naar één receptpagina, of null. Liever null dan een verzonnen pad.

${AH_URL_RULES}

De volgorde en titels moeten overeenkomen met de input.`;

export type DiscoveredRecipeRef = {
  titel: string;
  url: string | null;
  zoekhint: string | null;
  toelichting: string;
};

function isRecord(x: unknown): x is Record<string, unknown> {
  return x != null && typeof x === 'object' && !Array.isArray(x);
}

function discoverRowTitel(row: Record<string, unknown>): string {
  const a =
    (typeof row.titel === 'string' ? row.titel : null) ??
    (typeof row.title === 'string' ? row.title : null) ??
    (typeof row.naam === 'string' ? row.naam : null) ??
    (typeof row.name === 'string' ? row.name : null);
  return (a ?? '').trim();
}

export function parseDiscoverJson(raw: string): DiscoveredRecipeRef[] | null {
  let root: unknown;
  try {
    root = JSON.parse(coerceAnthropicJsonText(raw));
  } catch {
    return null;
  }
  if (!isRecord(root)) return null;
  const arr = Array.isArray(root.recepten)
    ? root.recepten
    : Array.isArray(root.recipes)
      ? root.recipes
      : [];
  const out: DiscoveredRecipeRef[] = [];
  for (const row of arr) {
    if (!isRecord(row)) continue;
    const titel = discoverRowTitel(row);
    if (!titel) continue;
    const url = typeof row.url === 'string' && row.url.trim().startsWith('http') ? row.url.trim() : null;
    const zoekhint =
      typeof row.zoekhint === 'string' && row.zoekhint.trim()
        ? row.zoekhint.trim()
        : typeof row.search_hint === 'string' && row.search_hint.trim()
          ? row.search_hint.trim()
          : null;
    const toelichting =
      typeof row.toelichting === 'string' && row.toelichting.trim() ? row.toelichting.trim() : '';
    out.push({ titel, url, zoekhint, toelichting });
  }
  return out.length > 0 ? out : null;
}

/** Zorg dat url=null altijd een bruikbare zoekhint heeft (voor web search). */
export function enrichDiscoveredForWebSearch(items: DiscoveredRecipeRef[]): DiscoveredRecipeRef[] {
  return items.map((i) => {
    if (i.url?.trim()) return i;
    let zh = i.zoekhint?.trim();
    if (zh) return { ...i, zoekhint: zh };
    const blob = `${i.titel} ${i.toelichting}`.toLowerCase();
    if (/allerhande|\bah\b|albert heijn|\.ah\.|ah logo|ah\.nl/i.test(blob)) {
      zh = `${i.titel} ah.nl allerhande recept`;
    } else {
      zh = `${i.titel} recept`;
    }
    return { ...i, zoekhint: zh };
  });
}

/** AH gebruikt vaak /recepten/<slug> of /allerhande/recepten/… in de UI; dat zijn geen enkele-recept-URL’s. */
function isDiscouragedAhRecipeUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== 'www.ah.nl' && host !== 'ah.nl') return false;
  const path = parsed.pathname;
  if (/^\/recepten(\/|$)/i.test(path)) return true;
  if (/^\/allerhande\/recepten\//i.test(path)) return true;
  return false;
}

/** Verwijder bekende foute AH-URL’s zodat een tweede resolve-poging volgt. */
function stripDiscouragedAhRecipeUrls(items: DiscoveredRecipeRef[]): DiscoveredRecipeRef[] {
  return items.map((i) => {
    const u = i.url?.trim();
    if (!u || !isDiscouragedAhRecipeUrl(u)) return i;
    return {
      ...i,
      url: null,
      zoekhint: i.zoekhint ?? `${i.titel} Albert Heijn allerhande`,
    };
  });
}

/**
 * Ontbrekende URL’s laten invullen door AI, daarna bekende foute AH-paden strippen en opnieuw proberen.
 * Web search: eerst volgens Instellingen; als er daarna nog recepten zonder URL zijn, altijd één extra pass
 * met web search op zoekhint/titel (zodat een foto zonder zichtbare link alsnog gevonden kan worden).
 */
export async function resolveRecipeUrlsForPhotoImport(
  items: DiscoveredRecipeRef[]
): Promise<DiscoveredRecipeRef[]> {
  let out = stripDiscouragedAhRecipeUrls(enrichDiscoveredForWebSearch(items));

  const noneHaveUrl = out.every((i) => !i.url?.trim());
  if (noneHaveUrl) {
    out = await resolveMissingRecipeUrls(out, { forceWebSearch: true });
    out = stripDiscouragedAhRecipeUrls(out);
  } else {
    out = await resolveMissingRecipeUrls(out);
    out = stripDiscouragedAhRecipeUrls(out);
  }

  if (out.some((i) => !i.url?.trim())) {
    out = await resolveMissingRecipeUrls(out);
    out = stripDiscouragedAhRecipeUrls(out);
  }
  if (out.some((i) => !i.url?.trim())) {
    out = await resolveMissingRecipeUrls(out, { forceWebSearch: true });
    out = stripDiscouragedAhRecipeUrls(out);
  }
  return out;
}

/** Eerste plausibele recept-URL uit ruwe modeltekst (fallback als JSON-parse faalt). */
function scrapePlausibleRecipeUrlFromText(raw: string): string | null {
  const re = /https?:\/\/[^\s\]"'<)]+/gi;
  let m: RegExpExecArray | null;
  const candidates: string[] = [];
  while ((m = re.exec(raw)) !== null) {
    let u = m[0].replace(/[.,;:!?)'"\]]+$/g, '');
    if (u.endsWith('.')) u = u.slice(0, -1);
    candidates.push(u);
  }
  for (const u of candidates) {
    try {
      const parsed = new URL(u);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;
      if (isDiscouragedAhRecipeUrl(u)) continue;
      const h = parsed.hostname.toLowerCase();
      const p = parsed.pathname;
      const ahOk =
        (h === 'www.ah.nl' || h === 'ah.nl') &&
        (/^\/allerhande\/recept\//i.test(p) || /^\/r\/\d+/i.test(p));
      const other =
        /allerhande\.nl/i.test(h) ||
        /njam\.tv/i.test(h) ||
        /24kitchen\.nl/i.test(h) ||
        /lekkerensimpel\.com/i.test(h);
      if (ahOk || other) return u;
    } catch {
      /* */
    }
  }
  return null;
}

function parseResolveJson(raw: string): Map<string, string | null> {
  const map = new Map<string, string | null>();
  let root: unknown;
  try {
    root = JSON.parse(coerceAnthropicJsonText(raw));
  } catch {
    return map;
  }
  if (!isRecord(root)) return map;
  const arr = Array.isArray(root.recepten)
    ? root.recepten
    : Array.isArray(root.recipes)
      ? root.recipes
      : [];
  for (const row of arr) {
    if (!isRecord(row)) continue;
    const titel = discoverRowTitel(row);
    const url =
      typeof row.url === 'string' && row.url.trim().startsWith('http') ? row.url.trim() : null;
    if (titel) map.set(titel, url);
  }
  return map;
}

export async function discoverRecipesFromPhoto(
  imageBase64: string,
  imageMediaType: AiImageMediaType
): Promise<{ ok: true; recepten: DiscoveredRecipeRef[] } | { ok: false; message: string }> {
  const userPrimary =
    'Analyseer deze afbeelding en geef het JSON-object met alle recepten volgens het schema. Geen markdown, alleen JSON.';

  const res = await callAiWithImageText({
    system: DISCOVER_SYSTEM,
    userText: userPrimary,
    imageBase64,
    imageMediaType,
    maxTokens: 4096,
  });
  if (!res.ok) return { ok: false, message: res.message };

  let recepten = parseDiscoverJson(res.text);
  if (!recepten) {
    const res2 = await callAiWithImageText({
      system: DISCOVER_SYSTEM,
      userText:
        'De vorige poging was geen geldig JSON of "recepten" was leeg. Probeer opnieuw: alleen één JSON-object, velden titel, url (of null), zoekhint (verplicht als url null), toelichting. Minstens 1 recept als er een gerecht of recepttitel op de foto staat. Geen code fences.',
      imageBase64,
      imageMediaType,
      maxTokens: 4096,
    });
    if (!res2.ok) return { ok: false, message: res2.message };
    recepten = parseDiscoverJson(res2.text);
  }

  if (!recepten) {
    return { ok: false, message: 'Kon geen recepten uit de afbeelding halen. Probeer een scherpere foto.' };
  }
  return { ok: true, recepten: enrichDiscoveredForWebSearch(recepten) };
}

/** Vul ontbrekende URL’s aan met een (tekst-only) AI-aanroep. */
export async function resolveMissingRecipeUrls(
  items: DiscoveredRecipeRef[],
  options?: { forceWebSearch?: boolean }
): Promise<DiscoveredRecipeRef[]> {
  const need = items.filter((i) => !i.url?.trim());
  if (need.length === 0) return items;

  const payload = need.map((i) => ({
    titel: i.titel,
    zoekhint: (i.zoekhint ?? i.toelichting ?? i.titel).trim() || i.titel,
  }));

  const useWeb = options?.forceWebSearch === true || (await getImportWebSearchEnabled());
  const baseUser = JSON.stringify({ recepten: payload }, null, 2);
  const res = useWeb
    ? await callAiTextWithWebSearch({
        system: RESOLVE_URLS_SYSTEM_WEB,
        user: baseUser,
        maxTokens: 4096,
      })
    : await callAiText({
        system: RESOLVE_URLS_SYSTEM,
        user: baseUser,
        maxTokens: 2048,
      });
  if (!res.ok) return items;

  const resolved = parseResolveJson(res.text);
  const needCount = need.length;
  let singleUnkeyedUrl: string | null = null;
  if (needCount === 1) {
    for (const v of resolved.values()) {
      if (v && v.startsWith('http')) {
        singleUnkeyedUrl = v;
        break;
      }
    }
  }

  const merged = items.map((i) => {
    if (i.url?.trim()) return i;
    const keyed = resolved.get(i.titel);
    const u = keyed ?? singleUnkeyedUrl;
    return u ? { ...i, url: u } : i;
  });

  const scraped = scrapePlausibleRecipeUrlFromText(res.text);
  if (!scraped) return merged;

  const stillMissing = merged.filter((i) => !i.url?.trim());
  if (stillMissing.length === 0) return merged;
  if (stillMissing.length === 1) {
    return merged.map((i) => (!i.url?.trim() ? { ...i, url: scraped } : i));
  }
  let used = false;
  return merged.map((i) => {
    if (i.url?.trim()) return i;
    if (!used) {
      used = true;
      return { ...i, url: scraped };
    }
    return i;
  });
}

/** Zoek een recept-URL op het web op basis van vrije tekst (zelfde pipeline als foto-import). */
export async function resolveRecipeUrlFromSearchQuery(query: string): Promise<string | null> {
  const q = query.trim();
  if (!q) return null;
  const resolved = await resolveRecipeUrlsForPhotoImport([
    { titel: q, url: null, zoekhint: q, toelichting: '' },
  ]);
  const u = resolved[0]?.url?.trim();
  return u && u.startsWith('http') ? u : null;
}

export type PhotoImportRowStatus = 'pending' | 'loading' | 'ok' | 'error';

export type PhotoImportRow = {
  titel: string;
  url: string | null;
  toelichting: string;
  status: PhotoImportRowStatus;
  message?: string;
  payload?: RecipeSavePayload;
};

/** Minimaal recept voor handmatig afronden als URL-download of AI-extractie faalt. */
export function buildManualFallbackImportPayload(
  title: string,
  sourceUrl: string,
  extractionHint?: string
): RecipeSavePayload {
  const hint = extractionHint?.trim();
  return {
    title: title.trim() || 'Nieuw recept',
    description: '',
    sourceUrl: sourceUrl.trim(),
    baseServings: 4,
    prepTimeMin: null,
    cookTimeMin: null,
    totalTimeMin: null,
    category: '',
    dietVegetarian: false,
    dietVegan: false,
    dietKeto: false,
    isFavorite: false,
    wantToTry: false,
    notes: hint ?? '',
    imageUri: '',
    tagNames: [],
    ingredientGroups: [{ title: '', ingredients: [{ name: '', amount: null, unit: null }] }],
    stepSections: [
      {
        title: '',
        steps: [
          {
            description:
              'Automatische import kon geen volledige structuur uit de pagina halen. Vul ingrediënten en stappen hieronder handmatig in, of open de bron-URL in je browser om te kopiëren.',
            timerSeconds: null,
          },
        ],
      },
    ],
  };
}

export type FetchAndExtractResult =
  | { ok: true; payload: RecipeSavePayload }
  | { ok: false; message: string; rawModelText?: string; debugSnippet?: string };

export async function fetchAndExtractOneRecipe(url: string): Promise<FetchAndExtractResult> {
  try {
    const html = await fetchRecipePageHtml(url);
    const extracted = await extractRecipeFromPageHtml(html, url);
    if (!extracted.ok) {
      return {
        ok: false,
        message: extracted.message,
        rawModelText: extracted.rawModelText,
        debugSnippet: extracted.debugSnippet,
      };
    }
    let imageUri = extracted.payload.imageUri?.trim() ?? '';
    if (!imageUri) {
      const heroUrl = pickHeroImageUrlFromRecipeHtml(html, url);
      if (heroUrl) {
        const local = await downloadRecipeCoverFromUrl(heroUrl, { refererPageUrl: url });
        if (local) imageUri = local;
      }
    }
    return { ok: true, payload: { ...extracted.payload, imageUri } };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'Download of extractie mislukt.',
    };
  }
}
