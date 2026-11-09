/**
 * Bridge tussen de import-flows en een pool van verborgen WebViews
 * (gemount door components/RecipeWebViewLoader.tsx).
 *
 * Waarom: sites als ah.nl blokkeren gewone `fetch`-calls server-side met Akamai
 * Bot Manager (HTTP 403). Een echte WebView draait de JavaScript-checks van de
 * site wel, dus laden via de WebView is de betrouwbare route op iOS/Android.
 *
 * De WebView-workers "huren" zichzelf in bij deze bridge. Zodra er een paginahaal
 * wordt aangevraagd terwijl er een idle worker is, krijgt die worker de klus;
 * anders zakt de klus in de wachtrij (bulk-import blijft gewoon werken).
 * Zijn er helemaal geen workers (web build, component niet gemount), dan valt
 * de aanroeper terug op de gewone fetch — zie fetchRecipePage.ts.
 */

/** Wat de WebView aan paginadata teruggeeft na het laden van een receptpagina. */
export type WebViewPageData = {
  title: string;
  metaDescription: string;
  jsonLd: string[];
  visibleText: string;
};

/** Interne klus voor een WebView-worker. */
export type WebViewJob = {
  id: number;
  url: string;
  resolve: (html: string) => void;
  reject: (err: Error) => void;
};

type WorkerHandler = (job: WebViewJob) => void;

let jobSeq = 1;
const idleWorkers: WorkerHandler[] = [];
const pendingJobs: WebViewJob[] = [];
let registeredWorkerCount = 0;

function pump(): void {
  if (idleWorkers.length === 0 || pendingJobs.length === 0) return;
  const job = pendingJobs.shift();
  const worker = idleWorkers.shift();
  if (!job || !worker) return;
  try {
    worker(job);
  } catch (e) {
    // Worker crashte meteen: klus afwijzen en worker opnieuw beschikbaar melden.
    job.reject(e instanceof Error ? e : new Error('Webweergave kon niet starten.'));
    idleWorkers.push(worker);
    pump();
  }
}

/** Registreer een WebView-worker (aangeroepen door RecipeWebViewLoader). Geeft een unregister-functie terug. */
export function registerWebViewWorker(onJob: WorkerHandler): () => void {
  const handler = onJob;
  idleWorkers.push(handler);
  registeredWorkerCount += 1;
  pump();
  return () => {
    const i = idleWorkers.indexOf(handler);
    if (i >= 0) {
      idleWorkers.splice(i, 1);
      registeredWorkerCount -= 1;
      // Geen workers meer (bijv. scherm verlaten): laat wachtende klussen niet hangen.
      if (registeredWorkerCount === 0 && idleWorkers.length === 0) {
        while (pendingJobs.length > 0) {
          pendingJobs
            .shift()
            ?.reject(new Error('De webweergave is afgesloten terwijl de pagina werd geladen.'));
        }
      }
    }
  };
}

/** Meld een worker weer beschikbaar nadat een klus is afgerond (succes of fout). */
export function reportWebViewWorkerIdle(onJob: WorkerHandler): void {
  if (idleWorkers.indexOf(onJob) === -1) {
    idleWorkers.push(onJob);
  }
  pump();
}

/** Aantal geregistreerde workers (idle + bezig); 0 betekent: geen webview-route beschikbaar. */
export function getWebViewWorkerCount(): number {
  return registeredWorkerCount;
}

/**
 * Haal een pagina op via een verborgen WebView. Resolved met een synthetisch
 * HTML-document (titel, meta, zichtbare tekst en JSON-LD-blokken) dat compatibel
 * is met extractRecipeFromPageHtml / filterRecipePageHtml.
 */
export function requestRecipePageHtmlViaWebView(url: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    pendingJobs.push({ id: jobSeq++, url, resolve, reject });
    pump();
  });
}

const MAX_JSONLD_CHARS = 60_000;
const MAX_VISIBLE_TEXT_CHARS = 24_000;

/**
 * Bouw uit de WebView-data een compact, synthetisch HTML-document.
 * JSON-LD zit in echte `<script type="application/ld+json">`-tags zodat
 * extractApplicationLdJsonScripts (recipePageHtmlFilter) ze vindt; `</` binnen
 * de JSON wordt veilig ge-escapet zodat de extractie-regex niet te vroeg afsluit.
 */
export function buildRecipeHtmlFromWebViewData(data: WebViewPageData): string {
  const jsonLdBlocks = data.jsonLd
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => (chunk.length > MAX_JSONLD_CHARS ? chunk.slice(0, MAX_JSONLD_CHARS) : chunk))
    .map((chunk) => `<script type="application/ld+json">${chunk.replace(/<\//g, '<\\/')}</script>`)
    .join('\n');

  const visibleText = data.visibleText
    .replace(/</g, '&lt;')
    .slice(0, MAX_VISIBLE_TEXT_CHARS)
    .trim();

  const title = (data.title ?? '').replace(/</g, '&lt;').trim();
  const desc = (data.metaDescription ?? '').replace(/</g, '&lt;').trim();

  return `<html><head><title>${title}</title></head><body><h1>${title}</h1><p>${desc}</p><pre>${visibleText}</pre>${jsonLdBlocks}</body></html>`;
}

/** Signaal dat de geladen pagina waarschijnlijk een blokkade-/foutpagina is. */
export function isBlockedPageData(data: WebViewPageData): boolean {
  const t = (data.title ?? '').toLowerCase();
  if (t.includes('access denied') || t.includes('toegang geweigerd')) return true;
  if (data.visibleText.toLowerCase().includes('akamai') && data.jsonLd.length === 0) return true;
  return false;
}
