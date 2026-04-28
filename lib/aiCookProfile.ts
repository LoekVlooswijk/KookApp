import { deleteAppMeta, getAppMeta, setAppMeta } from './appMeta';

const META_AI_COOK_PROFILE = 'ai_cook_profile_v1';

export type AiCookProfileAppliesTo = {
  tipsChat: boolean;
  adjustRecipe: boolean;
  recipeSuggestions: boolean;
};

export type AiCookProfile = {
  mustNot: string[];
  avoid: string[];
  prefer: string[];
  freeText: string;
  /** Stores/shops the user can realistically buy ingredients from. */
  nearbyShops: string[];
  /** User-defined shop options shown in the settings UI. */
  shopOptions: string[];
  /** Default servings used for week planning and other AI suggestions. */
  defaultServings: number;
  /** Extra context for week planning / recipe suggestions (feature 8). */
  weekPlanningTimeNotes: string;
  appliesTo: AiCookProfileAppliesTo;
};

const DEFAULT_PROFILE: AiCookProfile = {
  mustNot: [],
  avoid: [],
  prefer: [],
  freeText: '',
  nearbyShops: [],
  shopOptions: [],
  defaultServings: 2,
  weekPlanningTimeNotes: '',
  appliesTo: { tipsChat: true, adjustRecipe: true, recipeSuggestions: true },
};

let profileCache: AiCookProfile = DEFAULT_PROFILE;

function normalizeLines(input: unknown): string[] {
  const s = typeof input === 'string' ? input : '';
  const parts = s
    .split(/\r?\n/g)
    .map((x) => x.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

function normalizeStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of input) {
    const s = typeof x === 'string' ? x.trim() : '';
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

function normalizeProfile(raw: unknown): AiCookProfile {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_PROFILE;
  const r = raw as any;
  const appliesTo: AiCookProfileAppliesTo = {
    tipsChat: r?.appliesTo?.tipsChat !== false,
    adjustRecipe: r?.appliesTo?.adjustRecipe !== false,
    recipeSuggestions: r?.appliesTo?.recipeSuggestions !== false,
  };
  const dsRaw = typeof r.defaultServings === 'number' ? r.defaultServings : Number.parseInt(String(r.defaultServings ?? ''), 10);
  const defaultServings = Number.isFinite(dsRaw) ? Math.max(1, Math.min(99, Math.round(dsRaw))) : DEFAULT_PROFILE.defaultServings;
  return {
    mustNot: normalizeStringArray(r.mustNot),
    avoid: normalizeStringArray(r.avoid),
    prefer: normalizeStringArray(r.prefer),
    freeText: typeof r.freeText === 'string' ? r.freeText.trim() : '',
    nearbyShops: normalizeStringArray(r.nearbyShops),
    shopOptions: normalizeStringArray(r.shopOptions),
    defaultServings,
    weekPlanningTimeNotes: typeof r.weekPlanningTimeNotes === 'string' ? r.weekPlanningTimeNotes.trim() : '',
    appliesTo,
  };
}

export async function hydrateAiCookProfileFromDb(): Promise<void> {
  const raw = await getAppMeta(META_AI_COOK_PROFILE);
  if (!raw) {
    profileCache = DEFAULT_PROFILE;
    return;
  }
  try {
    profileCache = normalizeProfile(JSON.parse(raw) as unknown);
  } catch {
    profileCache = DEFAULT_PROFILE;
  }
}

export function getAiCookProfile(): AiCookProfile {
  return profileCache;
}

export async function setAiCookProfile(next: AiCookProfile): Promise<void> {
  profileCache = normalizeProfile(next);
  const hasAny =
    profileCache.mustNot.length > 0 ||
    profileCache.avoid.length > 0 ||
    profileCache.prefer.length > 0 ||
    profileCache.nearbyShops.length > 0 ||
    profileCache.shopOptions.length > 0 ||
    !!profileCache.freeText.trim() ||
    !!profileCache.weekPlanningTimeNotes.trim() ||
    profileCache.defaultServings !== DEFAULT_PROFILE.defaultServings;
  if (!hasAny) {
    await deleteAppMeta(META_AI_COOK_PROFILE);
    return;
  }
  await setAppMeta(META_AI_COOK_PROFILE, JSON.stringify(profileCache));
}

export async function clearAiCookProfile(): Promise<void> {
  profileCache = DEFAULT_PROFILE;
  await deleteAppMeta(META_AI_COOK_PROFILE);
}

export type AiCookProfilePurpose = 'tipsChat' | 'adjustRecipe' | 'recipeSuggestions';

export function formatAiCookProfileForPrompt(purpose: AiCookProfilePurpose): string {
  const p = getAiCookProfile();
  if (!p.appliesTo[purpose]) return '';

  const must = p.mustNot;
  const avoid = p.avoid;
  const prefer = p.prefer;
  const free = p.freeText.trim();
  const timeNotes = p.weekPlanningTimeNotes.trim();
  const shops = p.nearbyShops;
  const includeTimeNotes = purpose === 'recipeSuggestions' && !!timeNotes;
  const hasAny = must.length > 0 || avoid.length > 0 || prefer.length > 0 || shops.length > 0 || !!free || includeTimeNotes;
  if (!hasAny) return '';

  const lines: string[] = [];
  lines.push('---');
  lines.push('KOOKPROFIEL VAN DE GEBRUIKER (altijd respecteren)');
  lines.push('');
  lines.push('Regels:');
  lines.push('- MUST NOT: dit zijn harde grenzen (allergie/verboden). Als een vraag hiermee botst: weiger kort en bied 2 alternatieven.');
  lines.push('- AVOID: vermijd waar mogelijk; als je toch gebruikt, leg kort uit waarom.');
  lines.push('- PREFER: volg meestal; als je afwijkt, leg kort uit waarom.');
  lines.push('');

  if (must.length > 0) {
    lines.push('MUST NOT:');
    for (const x of must) lines.push(`- ${x}`);
    lines.push('');
  }
  if (avoid.length > 0) {
    lines.push('AVOID:');
    for (const x of avoid) lines.push(`- ${x}`);
    lines.push('');
  }
  if (prefer.length > 0) {
    lines.push('PREFER:');
    for (const x of prefer) lines.push(`- ${x}`);
    lines.push('');
  }
  if (shops.length > 0) {
    lines.push('Beschikbare winkels (ingrediënten moeten daar verkrijgbaar zijn):');
    for (const x of shops) lines.push(`- ${x}`);
    lines.push('');
  }
  if (free) {
    lines.push('Extra instructie:');
    lines.push(free);
    lines.push('');
  }

  if (includeTimeNotes) {
    lines.push('Weekplanning — tijdschema / beschikbaarheid:');
    lines.push(timeNotes);
    lines.push('');
  }

  return lines.join('\n').trim();
}

export function aiCookProfileLinesToText(lines: string[]): string {
  return (lines ?? []).map((x) => x.trim()).filter(Boolean).join('\n').trim();
}

export function aiCookProfileTextToLines(text: string): string[] {
  return normalizeLines(text);
}

