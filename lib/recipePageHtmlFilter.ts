/**
 * Shrinks fetched recipe-page HTML before sending it to the AI: removes boilerplate
 * and prefers semantic main/article regions to cut input tokens.
 */

const NOISE_BLOCK_TAGS = [
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'iframe',
  'video',
  'audio',
  'canvas',
  'picture',
] as const;

const JSON_LD_SCRIPT_TYPE_RE = /type\s*=\s*["']application\/ld\+json["']/i;

/** Zelfde tekst als in `filterRecipePageHtml` bij het toevoegen van JSON-LD (voor slim inkorten in extract). */
export const JSON_LD_BLOCKS_MARKER =
  '\n\nJSONLD_BLOCKS (schema.org; gebruik voor titel, ingrediënten, stappen):\n';

/**
 * Recipe sites (o.a. Albert Heijn / Allerhande) zetten vaak `schema.org/Recipe` in
 * `<script type="application/ld+json">`. Die blokken moeten bewaard blijven: anders
 * bevat de gefilterde HTML geen ingrediënten meer voordat het naar de AI gaat.
 */
export function extractApplicationLdJsonScripts(html: string): string[] {
  const out: string[] = [];
  const scriptRe = /<script\b[^>]*>[\s\S]*?<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = scriptRe.exec(html)) !== null) {
    const full = m[0];
    const openAttrs = full.match(/^<script\b([^>]*)>/i)?.[1] ?? '';
    if (!JSON_LD_SCRIPT_TYPE_RE.test(openAttrs)) continue;
    const inner = full.replace(/^<script\b[^>]*>/i, '').replace(/<\/script\s*>$/i, '');
    const t = inner.trim();
    if (t.length > 0) out.push(t);
  }
  return out;
}

/** Strip obvious non-content blocks (case-insensitive, non-nested-safe is enough for typical pages). */
function stripBlockTags(html: string, tag: string): string {
  const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, 'gi');
  return html.replace(re, '');
}

function stripHtmlComments(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, '');
}

/** data: URLs in attributes are huge and useless for recipe text. */
function stripDataUrlAttributes(html: string): string {
  return html.replace(/\s(src|href|poster)\s*=\s*"(?:data:[^"]*)"/gi, ' $1=""');
}

function stripHead(html: string): string {
  return html.replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/gi, '');
}

/**
 * Find `<tagName ...>` (first match, case-insensitive) and return inner HTML of the
 * matching balanced closing tag, or null if not well-formed.
 */
function extractBalancedElementInner(html: string, tagName: string): string | null {
  const openRe = new RegExp(`<${tagName}\\b[^>]*>`, 'i');
  const openMatch = openRe.exec(html);
  if (!openMatch || openMatch.index === undefined) return null;

  let pos = openMatch.index + openMatch[0].length;
  let depth = 1;
  const len = html.length;

  const reOpen = new RegExp(`<${tagName}\\b[^>]*>`, 'gi');
  const reClose = new RegExp(`<\\/${tagName}\\s*>`, 'gi');

  while (pos < len && depth > 0) {
    reOpen.lastIndex = pos;
    reClose.lastIndex = pos;
    const nextOpen = reOpen.exec(html);
    const nextClose = reClose.exec(html);

    const openIdx = nextOpen?.index;
    const closeIdx = nextClose?.index;

    if (closeIdx == null) return null;

    if (openIdx != null && openIdx < closeIdx) {
      depth += 1;
      pos = openIdx + (nextOpen?.[0].length ?? 0);
      continue;
    }

    depth -= 1;
    pos = closeIdx + (nextClose?.[0].length ?? 0);
    if (depth === 0) {
      return html.slice(openMatch.index + openMatch[0].length, closeIdx);
    }
  }

  return null;
}

/** All balanced <article>…</article> bodies; pick the longest (often the recipe). */
function longestArticleInner(html: string): string | null {
  const re = /<article\b[^>]*>/gi;
  const candidates: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const start = m.index;
    const sliceFrom = html.slice(start);
    const inner = extractBalancedElementInner(sliceFrom, 'article');
    if (inner != null) candidates.push(inner);
  }
  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) => (b.length > a.length ? b : a));
}

/** Optional site chrome after we already narrowed to body/main/article. */
function stripAuxiliarySections(html: string): string {
  let s = html;
  for (const tag of ['nav', 'footer', 'aside', 'header'] as const) {
    s = stripBlockTags(s, tag);
  }
  return s;
}

function collapseWhitespace(html: string): string {
  return html.replace(/\s+/g, ' ').replace(/>\s+</g, '><').trim();
}

/**
 * Convert (already reduced) HTML into a lightweight plain-text signal for the model.
 * JSON-LD is appended separately and is the primary source when present.
 */
function htmlToLightText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Public: reduce raw page HTML to a smaller string that still carries recipe content.
 */
export function filterRecipePageHtml(html: string): string {
  const jsonLdChunks = extractApplicationLdJsonScripts(html);
  let s = html;

  s = stripHtmlComments(s);
  for (const tag of NOISE_BLOCK_TAGS) {
    s = stripBlockTags(s, tag);
  }
  s = stripDataUrlAttributes(s);
  s = stripHead(s);

  const bodyInner = extractBalancedElementInner(s, 'body');
  if (bodyInner != null) {
    s = bodyInner;
  }

  const mainInner = extractBalancedElementInner(s, 'main');
  if (mainInner != null && mainInner.length >= 400) {
    s = stripAuxiliarySections(mainInner);
  } else {
    const art = longestArticleInner(s);
    if (art != null && art.length >= 400) {
      s = stripAuxiliarySections(art);
    } else {
      s = stripAuxiliarySections(s);
    }
  }

  s = collapseWhitespace(s);

  // The model doesn't need full markup at this point; keep a compact text-only signal.
  // This materially reduces input tokens on big sites while still giving fallback context.
  const lightText = htmlToLightText(s);

  if (jsonLdChunks.length === 0) {
    return lightText;
  }

  const appendix = jsonLdChunks.join('\n---JSONLD---\n');
  return `${lightText}${JSON_LD_BLOCKS_MARKER}${appendix}`;
}
