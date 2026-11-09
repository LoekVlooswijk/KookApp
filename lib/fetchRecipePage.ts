/**
 * Laadt ruwe receptpagina-inhoud.
 *
 * Native (iOS/Android): sites als ah.nl blokkeren gewone fetches met Akamai
 * Bot Manager (HTTP 403). Een echte webview draait die JavaScript-checks wél,
 * dus daar laden we via de verborgen WebView-pool (RecipeWebViewLoader) en
 * vallen we alleen terug op fetch als er geen webview beschikbaar is of de
 * webview-route fout gaat.
 *
 * Web: geen react-native-webview; daar blijft de gewone fetch in gebruik
 * (CORS-blokkades hebben dan alsnog de bestaande foutmelding tot gevolg).
 */
import { Platform } from 'react-native';

import { getWebViewWorkerCount, requestRecipePageHtmlViaWebView } from './recipePageWebViewBridge';

export function assertValidRecipeUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new Error('Voer een geldige http(s)-URL in.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Alleen http- of https-URL’s zijn toegestaan.');
  }
  return parsed;
}

async function fetchRecipePageHtmlDirect(url: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url.trim(), {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'nl,en;q=0.9',
        'User-Agent':
          'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
      },
    });
  } catch {
    throw new Error(
      'Download mislukt (netwerk). Op web blokkeren sommige sites externe aanroepen (CORS); probeer iOS/Android.'
    );
  }

  if (!res.ok) {
    throw new Error(`Pagina kon niet worden geladen (HTTP ${res.status}).`);
  }

  return await res.text();
}

export async function fetchRecipePageHtml(url: string): Promise<string> {
  assertValidRecipeUrl(url);

  const useWebView = Platform.OS !== 'web' && getWebViewWorkerCount() > 0;
  if (useWebView) {
    try {
      return await requestRecipePageHtmlViaWebView(url.trim());
    } catch {
      // Webview-route faalde (blokkade/netwerk): probeer daarna de gewone fetch,
      // die voor niet-bot-blokkerende sites vaak genoeg is.
    }
  }

  return await fetchRecipePageHtmlDirect(url);
}
