import { callAiText } from './aiClient';
import { hydrateBioScoreExcludePrefsFromDb, isBioScoreExcludedName } from './bioScoreExcludePrefs';
import { normalizeBioScoreIngredientName } from './bioScoreNameMatch';
import {
  findBioScoreOverrideForName,
  getBioScoreOverridesList,
  hydrateBioScoreOverridesPrefsFromDb,
} from './bioScoreOverridesPrefs';
import { getBioScoreThresholds, hydrateBioScoreThresholdsFromDb } from './bioScoreThresholdsPrefs';
import { coerceModelJsonText } from './recipeExtract';
import {
  BIO_SCORE_OUTPUT_SCHEMA,
  buildAiRepairUserPrompt,
  buildBioScoreSystemPrompt,
  buildBioScoreUserPrompt,
} from './aiPromptTemplates';
import {
  getShoppingOrganicAlwaysList,
  hydrateShoppingOrganicPrefsFromDb,
  isAlwaysOrganicItemName,
} from './shoppingOrganicPrefs';

export type BioLocalityCode = 'G' | 'O' | 'R';
export type BioPesticideCode = 'L' | 'M' | 'H';

export type BioAssessmentItem = {
  n: string;
  l: BioLocalityCode;
  p: BioPesticideCode;
};

function isRecord(x: unknown): x is Record<string, unknown> {
  return x != null && typeof x === 'object' && !Array.isArray(x);
}

function asString(x: unknown): string | null {
  return typeof x === 'string' ? x : null;
}

function isLocalityCode(x: unknown): x is BioLocalityCode {
  return x === 'G' || x === 'O' || x === 'R';
}

function isPesticideCode(x: unknown): x is BioPesticideCode {
  return x === 'L' || x === 'M' || x === 'H';
}

function isProduceCandidate(name: string): boolean {
  const n = normalizeBioScoreIngredientName(name);
  if (!n) return false;

  if (isBioScoreExcludedName(n)) return false;

  // Explicitly ignore aromatics like onion/garlic (as requested).
  const excludeAromatics = [
    'ui',
    'uien',
    'sjalot',
    'sjalotten',
    'knoflook',
    'look',
    'prei',
    'bosui',
    'lente-ui',
    'lenteui',
  ];
  if (excludeAromatics.some((t) => n === t || n.includes(t))) return false;

  // Exclude obvious non-produce pantry items.
  const excludeTokens = [
    'zout',
    'water',
    'suiker',
    'bloem',
    'meel',
    'rijst',
    'pasta',
    'noedels',
    'olie',
    'olijfolie',
    'boter',
    'azijn',
    'sojasaus',
    'bouillon',
    'melk',
    'kaas',
    'yoghurt',
    'ei',
    'eieren',
    'vlees',
    'kip',
    'rund',
    'varken',
    'vis',
    'zalm',
    'tonijn',
  ];
  if (excludeTokens.some((t) => n === t || n.includes(t))) return false;

  return true;
}

function uniqueNames(ingredients: string[], max: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(ingredients) ? ingredients : []) {
    const n = normalizeBioScoreIngredientName(typeof raw === 'string' ? raw : '');
    if (!n || seen.has(n)) continue;
    if (!isProduceCandidate(n)) continue;
    seen.add(n);
    out.push(n);
    if (out.length >= max) break;
  }
  return out;
}

export async function assessProduceLocalityAndPesticides(
  ingredients: string[]
): Promise<{ ok: true; items: BioAssessmentItem[] } | { ok: false; message: string }> {
  await hydrateBioScoreExcludePrefsFromDb();
  const uniq = uniqueNames(ingredients, 40);
  if (uniq.length === 0) return { ok: true, items: [] };
  const requested = new Set(uniq);

  const system = buildBioScoreSystemPrompt();
  const user = buildBioScoreUserPrompt(uniq);
  const tryParse = (raw: string): { ok: true; items: BioAssessmentItem[] } | { ok: false } => {
    let root: unknown;
    try {
      root = JSON.parse(coerceModelJsonText(raw));
    } catch {
      return { ok: false };
    }
    if (!isRecord(root)) return { ok: false };
    const itemsIn = Array.isArray(root.items) ? root.items : [];
    const out: BioAssessmentItem[] = [];
    for (const it of itemsIn) {
      if (!isRecord(it)) continue;
      const n = normalizeBioScoreIngredientName(asString(it.n) ?? '');
      if (!n) continue;
      if (!requested.has(n)) continue;
      const l = it.l;
      const p = it.p;
      if (!isLocalityCode(l) || !isPesticideCode(p)) continue;
      out.push({ n, l, p });
    }
    return { ok: true, items: out };
  };

  const ai = await callAiText({ system, user, maxTokens: 900, task: 'import' });
  if (!ai.ok) return { ok: false, message: ai.message };

  const parsed1 = tryParse(ai.text);
  if (parsed1.ok) return parsed1;

  const repairUser = buildAiRepairUserPrompt({
    purpose: 'bioScore',
    outputSchema: BIO_SCORE_OUTPUT_SCHEMA,
    previousOutput: ai.text,
    validationErrors: ['JSON parse failed or did not match expected shape (object.items[])'],
  });
  const repaired = await callAiText({ system, user: repairUser, maxTokens: 900, task: 'import' });
  if (!repaired.ok) return { ok: false, message: repaired.message };
  const parsed2 = tryParse(repaired.text);
  if (parsed2.ok) return parsed2;

  return { ok: false, message: 'AI gaf geen geldige JSON terug.' };
}

function downgradePesticide(p: BioPesticideCode): BioPesticideCode {
  if (p === 'H') return 'M';
  if (p === 'M') return 'L';
  return 'L';
}

export async function applyBioScoreOverridesToItems(
  items: BioAssessmentItem[]
): Promise<BioAssessmentItem[]> {
  await hydrateBioScoreOverridesPrefsFromDb();
  const overrides = getBioScoreOverridesList();
  return (Array.isArray(items) ? items : []).map((it) => {
    const ov = findBioScoreOverrideForName(it.n, overrides);
    if (!ov) return it;
    return { n: it.n, l: ov.l, p: ov.p };
  });
}

export async function applyOrganicAdjustmentsToBioItems(
  items: BioAssessmentItem[]
): Promise<BioAssessmentItem[]> {
  const itemsRaw = Array.isArray(items) ? items : [];
  await hydrateShoppingOrganicPrefsFromDb();
  const organicAlways = getShoppingOrganicAlwaysList();
  return itemsRaw.map((it) => {
    const alwaysBio = isAlwaysOrganicItemName(it.n, organicAlways);
    return { ...it, p: alwaysBio ? downgradePesticide(it.p) : it.p };
  });
}

/** Score prepared items (overrides + organic already applied). */
export async function computeBioColorFromPreparedItems(
  items: BioAssessmentItem[]
): Promise<'red' | 'orange' | 'green'> {
  const itemsRaw = Array.isArray(items) ? items : [];
  if (itemsRaw.length === 0) return 'green';

  await hydrateBioScoreThresholdsFromDb();
  const { orangeMin, redMin } = getBioScoreThresholds();

  let score = 0;
  for (const it of itemsRaw) {
    if (it.l === 'O') score += 1;
    if (it.l === 'R') score += 2;
    if (it.p === 'M') score += 1;
    if (it.p === 'H') score += 2;
  }

  if (score >= redMin) return 'red';
  if (score >= orangeMin) return 'orange';
  return 'green';
}

/** Raw AI items → overrides → organic → color + stored breakdown. */
export async function finalizeBioScoreFromAssessment(
  rawItems: BioAssessmentItem[]
): Promise<{ items: BioAssessmentItem[]; color: 'red' | 'orange' | 'green' }> {
  const afterOverrides = await applyBioScoreOverridesToItems(rawItems);
  const items = await applyOrganicAdjustmentsToBioItems(afterOverrides);
  const color = await computeBioColorFromPreparedItems(items);
  return { items, color };
}

/**
 * @param items Raw assessments from the model (not yet adjusted).
 * @deprecated Prefer finalizeBioScoreFromAssessment for full pipeline.
 */
export async function computeRecipeBioColorFromAssessments(params: {
  items: BioAssessmentItem[];
}): Promise<'red' | 'orange' | 'green'> {
  const { color } = await finalizeBioScoreFromAssessment(params.items);
  return color;
}

/** Re-score stored prepared items after exclude-list changes (no AI). */
export async function recomputeBioScoreFromPreparedItems(
  preparedItems: BioAssessmentItem[]
): Promise<{ items: BioAssessmentItem[]; color: 'red' | 'orange' | 'green' }> {
  await hydrateBioScoreExcludePrefsFromDb();
  const items = (Array.isArray(preparedItems) ? preparedItems : []).filter(
    (it) => !isBioScoreExcludedName(it.n)
  );
  const color = await computeBioColorFromPreparedItems(items);
  return { items, color };
}
