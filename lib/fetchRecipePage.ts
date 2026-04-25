/** Laadt ruwe HTML van een receptpagina (native: geen browser-CORS). */
export async function fetchRecipePageHtml(url: string): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new Error('Voer een geldige http(s)-URL in.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Alleen http- of https-URL’s zijn toegestaan.');
  }

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
