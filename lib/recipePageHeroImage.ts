/**
 * Haal een recept-hero-afbeelding uit ruwe HTML (og:image, twitter:image, JSON-LD Recipe).
 * Gebruikt dezelfde bron als de page fetch — geen extra AI.
 */

function resolveUrl(href: string, base: string): string | null {
  const t = href.trim();
  if (!t) return null;
  try {
    const u = new URL(t, base).href;
    return u.startsWith('http') ? u : null;
  } catch {
    return t.startsWith('http') ? t : null;
  }
}

function metaContent(html: string, prop: string, attr: 'property' | 'name'): string | null {
  const re1 = new RegExp(
    `<meta[^>]+${attr}=["']${prop}["'][^>]+content=["']([^"']+)["']`,
    'i'
  );
  const re2 = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+${attr}=["']${prop}["']`,
    'i'
  );
  const m = html.match(re1) ?? html.match(re2);
  return m?.[1]?.trim() ?? null;
}

function pickOgOrTwitterImage(html: string, pageUrl: string): string | null {
  for (const prop of ['og:image', 'og:image:url']) {
    const raw = metaContent(html, prop, 'property');
    if (raw) {
      const u = resolveUrl(raw, pageUrl);
      if (u) return u;
    }
  }
  const tw = metaContent(html, 'twitter:image', 'name');
  if (tw) {
    const u = resolveUrl(tw, pageUrl);
    if (u) return u;
  }
  return null;
}

function pickImageFromRecipeObject(node: Record<string, unknown>): string | null {
  const img = node.image;
  if (typeof img === 'string' && img.trim().startsWith('http')) return img.trim();
  if (Array.isArray(img)) {
    for (const x of img) {
      if (typeof x === 'string' && x.trim().startsWith('http')) return x.trim();
      if (x && typeof x === 'object') {
        const o = x as Record<string, unknown>;
        const u = o.url ?? o.contentUrl;
        if (typeof u === 'string' && u.trim().startsWith('http')) return u.trim();
      }
    }
  }
  if (img && typeof img === 'object') {
    const o = img as Record<string, unknown>;
    const u = o.url ?? o.contentUrl;
    if (typeof u === 'string' && u.trim().startsWith('http')) return u.trim();
  }
  return null;
}

function walkJsonLdForRecipeImage(node: unknown, pageUrl: string): string | null {
  if (node == null) return null;
  if (Array.isArray(node)) {
    for (const x of node) {
      const r = walkJsonLdForRecipeImage(x, pageUrl);
      if (r) return r;
    }
    return null;
  }
  if (typeof node !== 'object') return null;
  const o = node as Record<string, unknown>;
  const types = o['@type'];
  const isRecipe =
    types === 'Recipe' ||
    (Array.isArray(types) && types.some((t) => t === 'Recipe'));
  if (isRecipe) {
    const raw = pickImageFromRecipeObject(o);
    if (raw) {
      const u = resolveUrl(raw, pageUrl);
      if (u) return u;
    }
  }
  const g = o['@graph'];
  if (Array.isArray(g)) {
    for (const x of g) {
      const r = walkJsonLdForRecipeImage(x, pageUrl);
      if (r) return r;
    }
  }
  return null;
}

function collectJsonLdRoots(html: string): unknown[] {
  const out: unknown[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const inner = m[1].trim();
    if (!inner) continue;
    try {
      out.push(JSON.parse(inner));
    } catch {
      /* */
    }
  }
  return out;
}

/**
 * Eerste bruikbare recept-afbeeldings-URL (https) uit de pagina, of null.
 */
export function pickHeroImageUrlFromRecipeHtml(html: string, pageUrl: string): string | null {
  const og = pickOgOrTwitterImage(html, pageUrl);
  if (og) return og;

  for (const root of collectJsonLdRoots(html)) {
    const u = walkJsonLdForRecipeImage(root, pageUrl);
    if (u) return u;
  }
  return null;
}
