import { formatAiCookProfileForPrompt } from './aiCookProfile';

export type AiPurpose = 'recipeExtract' | 'adjustRecipe' | 'tipsChat' | 'recipeSuggestions' | 'weekPlan';

export const RECIPE_JSON_SCHEMA = `{
  "title": string,
  "description": string | null,
  "base_servings": number,
  "prep_time_min": number | null,
  "cook_time_min": number | null,
  "total_time_min": number | null,
  "category": string | null,
  "ingredient_groups": [
    {
      "title": string | null,
      "ingredients": [
        { "name": string, "amount": number | null, "unit": string | null }
      ]
    }
  ],
  "step_sections": [
    {
      "title": string | null,
      "steps": [
        { "description": string, "timer_seconds": number | null }
      ]
    }
  ],
  "tags": [string]
}`;

export const WEEK_PLAN_OUTPUT_SCHEMA = `{
  "ok": boolean,
  "new_recipes": [
    { "temp_id": string, "recipe": ${RECIPE_JSON_SCHEMA} }
  ],
  "plan": [
    {
      "date": "YYYY-MM-DD",
      "recipe_id": number | string,
      "servings": number,
      "cooks_for_days": number,
      "leftover_of_date": "YYYY-MM-DD" | null
    }
  ],
  "unsatisfied_constraints": [string],
  "rationale": [
    { "date": "YYYY-MM-DD", "recipe_id": number | string, "reason": string }
  ]
}`;

const AI_BASE_SYSTEM_PROMPT_NL = `Je bent een kook-assistent in een privacy-first app.
Antwoord altijd in het Nederlands.

Volg deze prioriteiten bij conflicts:
1) MUST NOT (allergie/verboden) > alles
2) Dieetregels > voorkeuren
3) Tijdschema/beschikbaarheid > variatie/creativiteit
4) Gebruikersvoorkeuren (PREFER) > hergebruik ingrediënten
5) Hergbruik ingrediënten > variatie`;

type BuildSystemPromptParams = {
  purpose: AiPurpose;
  /** Set to true for structured outputs where we need strict JSON. */
  jsonOnly?: boolean;
  /** Extra purpose-specific instructions (Dutch). */
  instructionsNl?: string;
};

export function buildAiSystemPrompt(params: BuildSystemPromptParams): string {
  const lines: string[] = [];
  lines.push(AI_BASE_SYSTEM_PROMPT_NL.trim());
  lines.push('');

  if (params.jsonOnly) {
    lines.push('Output-regel: retourneer ALLEEN geldige JSON. Geen markdown, geen uitleg, geen tekst ervoor of erna.');
    lines.push('');
  }

  if (params.instructionsNl?.trim()) {
    lines.push(params.instructionsNl.trim());
    lines.push('');
  }

  // Attach cook profile only where it makes sense.
  const profilePurpose =
    params.purpose === 'tipsChat'
      ? 'tipsChat'
      : params.purpose === 'adjustRecipe'
        ? 'adjustRecipe'
        : params.purpose === 'recipeSuggestions' || params.purpose === 'weekPlan'
          ? 'recipeSuggestions'
          : null;

  if (profilePurpose) {
    const block = formatAiCookProfileForPrompt(profilePurpose);
    if (block) {
      lines.push(block);
      lines.push('');
    }
  }

  return lines.join('\n').trim();
}

export type BuildRepairPromptParams = {
  purpose: AiPurpose;
  outputSchema: string;
  previousOutput: string;
  validationErrors: string[];
};

/**
 * A follow-up prompt for when the previous structured output was invalid.
 * Use this with the same system prompt (or a stricter "JSON only" system prompt) and call the model once more.
 */
export function buildAiRepairUserPrompt(params: BuildRepairPromptParams): string {
  const errs = (params.validationErrors ?? []).map((e) => e.trim()).filter(Boolean);
  const lines: string[] = [];
  lines.push('Je vorige antwoord was ongeldig of schond regels. Repareer het.');
  lines.push('');
  lines.push('VALIDATION_ERRORS:');
  if (errs.length === 0) {
    lines.push('- (geen details beschikbaar)');
  } else {
    for (const e of errs) lines.push(`- ${e}`);
  }
  lines.push('');
  lines.push('REQUIRED_OUTPUT_SCHEMA:');
  lines.push(params.outputSchema.trim());
  lines.push('');
  lines.push('PREVIOUS_OUTPUT:');
  lines.push(params.previousOutput.trim());
  lines.push('');
  lines.push('Retourneer opnieuw ALLEEN JSON dat exact voldoet aan het schema.');
  return lines.join('\n').trim();
}

export function buildRecipeExtractSystemPrompt(): string {
  return buildAiSystemPrompt({
    purpose: 'recipeExtract',
    jsonOnly: true,
    instructionsNl: `Je bent een recept-parser. Extraheer het recept uit de volgende HTML en retourneer ALLEEN één JSON-object (geen markdown, geen uitleg ervoor of erna) in exact dit schema:

Schema:
${RECIPE_JSON_SCHEMA}

Regels:
- Als de invoer een sectie "JSONLD_BLOCKS" bevat: gebruik die embedded JSON-LD (vaak schema.org/Recipe) als primaire bron voor titel, ingrediënten en bereiding; vul aan met zichtbare HTML waar nodig.
- Normaliseer eenheden: gebruik g, kg, ml, l, el, tl, stuk(s), teen, plak, tak, blad, snuf, of "naar smaak" waar passend.
- Groepeer ingrediënten als de pagina duidelijke secties heeft.
- Schat prep_time_min, cook_time_min, total_time_min als ze niet expliciet staan.
- timer_seconds: altijd een geheel aantal seconden (bijv. 30, 90; geen breuken in minuten zoals 0,5).
- Alle teksten in het Nederlands als de bron Nederlands is.
- Tags ("tags"): maximaal 6–8 nuttige steekwoorden (keuken, dieet, techniek, hoofdingrediënt, seizoen). Geen winkel- of merknamen, geen woorden als "recept", "snel" of "makkelijk" tenzij ze echt onderscheidend zijn.
- Gebruik liever vaste filterlabels: voor een avondmaaltijd-hoofdgang tag "hoofdgerecht", niet "diner" of "avondeten". Zet "vegetarisch" als het om vlees/vis-vrij gaat; "vegan" alleen bij echt plantaardig zonder dierlijke producten.
- Geen dubbele betekenis tussen maaltijdmoment en gang: geen combinatie van lunch, ontbijt, brunch, borrel of middageten samen met hoofdgerecht, voorgerecht, nagerecht, bijgerecht of tussengerecht.`,
  });
}

export function buildRecipeAdjustSystemPrompt(): string {
  return buildAiSystemPrompt({
    purpose: 'adjustRecipe',
    jsonOnly: true,
    instructionsNl: `De gebruiker heeft een notitie geschreven over een recept.
Pas het recept aan op basis van de notitie.
Retourneer het VOLLEDIGE aangepaste recept in hetzelfde JSON-schema als hieronder.
Wijzig ALLEEN wat de notitie impliceert; behoud overige onderdelen waar mogelijk.

Belangrijk (kooklogica):
- Als een wijziging invloed heeft op techniek (volgorde, temperatuur, timing, “even bakken/frituren”, toevoegen van vloeistof, etc.), pas dan ook de bereidingsstappen aan zodat het culinair klopt.
- Je mag stappen herschikken, splitsen of samenvoegen als dat nodig is voor correcte techniek, maar beperk je tot wat de notitie logisch veroorzaakt.

Schema:
${RECIPE_JSON_SCHEMA}`,
  });
}

export function buildWeekPlanSystemPrompt(): string {
  return buildAiSystemPrompt({
    purpose: 'weekPlan',
    jsonOnly: true,
    instructionsNl: `Je helpt met weekplanning voor maaltijden (alleen diner).
Je krijgt een lijst met dagen en een lijst met beschikbare recepten (met id's).
Houd rekening met de wensen van de gebruiker en met het tijdschema / beschikbaarheid uit het kookprofiel.

Output:
- Retourneer één JSON-object volgens dit schema:
${WEEK_PLAN_OUTPUT_SCHEMA}

Regels:
- Gebruik uitsluitend recipe_id’s die in de input staan.
- Elke date moet precies één keer voorkomen in "plan".
- Servings:
  - "servings" betekent het aantal eters voor die dag (dus meestal gelijk aan servings_default, tenzij de gebruiker iets anders vraagt).
  - Bij "cooks_for_days" > 1 kook je extra VOORUIT, maar "servings" blijft hetzelfde (niet verdubbelen).
- Restjes (2 dagen tegelijk koken):
  - HARD RULE: probeer de week zoveel mogelijk te plannen in 2-daagse blokken: kookdag + restjesdag erna.
    - Voorbeeld: dagen 1–2 samen, 3–4 samen, 5–6 samen, etc. (laatste dag mag solo).
  - PREFER: plan restjes bij voorkeur op de direct opvolgende geselecteerde dag(en) (dus zonder gaten).
    - Als je tóch een gat gebruikt (bijv. omdat er maar één kookdag mogelijk is), doe dat spaarzaam en leg kort uit in "rationale" en/of "unsatisfied_constraints".
  - Zet op de kookdag "cooks_for_days" op 2 of 3.
  - Voor de volgende dag(en) die restjes zijn: zet "leftover_of_date" op de kookdag (YYYY-MM-DD) en zet "cooks_for_days" op 1.
  - Restjes-dagen mogen geen nieuwe restjes genereren (dus geen cooks_for_days > 1 als leftover_of_date gezet is).
- Variatie (tegen herhaling):
  - HARD RULE: gebruik niet hetzelfde recept meerdere keren als “nieuw koken” binnen de geselecteerde dagen.
  - Herhaling is alleen toegestaan als het expliciet een restjes-dag is (leftover_of_date gezet).
  - HARD RULE: als INPUT_JSON "recently_used_recipe_ids" bevat: vermijd deze recepten als “nieuw koken”.
    - Alleen als er te weinig unieke opties zijn mag je hiervan afwijken; zet dan een duidelijke reden in "unsatisfied_constraints".
- Als de gebruiker expliciet vraagt om een nieuw recept toe te voegen (bijv. "voeg een nieuw recept toe: ..."):
  - Je mag maximaal 2 nieuwe recepten maken in "new_recipes".
  - Gebruik in "plan" dan "recipe_id" als string: de "temp_id" van het nieuwe recept.
  - Als de gebruiker dit niet vraagt: laat "new_recipes" weg of leeg.
- Als iets niet kan: vul "unsatisfied_constraints" met concrete redenen, maar geef alsnog een best-effort plan.`,
  });
}

export function buildWeekPlanUserPrompt(params: {
  days: string[];
  recipes: Array<{
    id: number;
    title: string;
    total_time_min?: number | null;
    category?: string | null;
    tags?: string[];
    key_ingredients?: string[];
    want_to_try?: boolean;
  }>;
  wishesText?: string;
  defaultServings?: number;
  recentlyUsedRecipeIds?: number[];
}): string {
  const days = Array.isArray(params.days) ? params.days : [];
  const pairBlocks: Array<{ cook_day: string; leftover_day: string }> = [];
  const soloDays: string[] = [];
  const isIsoDate = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s);
  const daysNorm = days.map((d) => (typeof d === 'string' ? d.trim() : '')).filter((d) => isIsoDate(d));
  // Only pair within consecutive calendar-day runs.
  // For odd-length runs: make the FIRST day solo, so cooking days cluster (e.g. 3 days -> solo day1, pair day2-3).
  // This prevents "cook once, then 2-3 days nothing, then cook again" patterns.
  const asDateMs = (dateOnly: string): number => {
    const [y, m, d] = dateOnly.split('-').map((x) => Number.parseInt(x, 10));
    return new Date(y, (m ?? 1) - 1, d ?? 1).getTime();
  };
  const dayDiff = (a: string, b: string): number => Math.round((asDateMs(a) - asDateMs(b)) / (24 * 60 * 60 * 1000));
  const runs: string[][] = [];
  let cur: string[] = [];
  for (const d of daysNorm) {
    if (cur.length === 0) {
      cur.push(d);
      continue;
    }
    const prev = cur[cur.length - 1] ?? '';
    if (dayDiff(d, prev) === 1) {
      cur.push(d);
    } else {
      runs.push(cur);
      cur = [d];
    }
  }
  if (cur.length > 0) runs.push(cur);

  for (const run of runs) {
    if (run.length <= 1) {
      if (run[0]) soloDays.push(run[0]);
      continue;
    }
    let startIdx = 0;
    if (run.length % 2 === 1) {
      // Make first day solo, then pair the remainder.
      soloDays.push(run[0] ?? '');
      startIdx = 1;
    }
    for (let i = startIdx; i + 1 < run.length; i += 2) {
      pairBlocks.push({ cook_day: run[i] ?? '', leftover_day: run[i + 1] ?? '' });
    }
  }
  const lastSoloDay = soloDays.length > 0 ? soloDays[soloDays.length - 1] ?? '' : '';
  const recent = Array.isArray(params.recentlyUsedRecipeIds) ? params.recentlyUsedRecipeIds : [];
  const recentlyUsedRecipeIds = Array.from(
    new Set(recent.map((x) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x) : -1)).filter((x) => x > 0))
  ).slice(0, 40);
  const input = {
    days: daysNorm,
    wishes_text: (params.wishesText ?? '').trim(),
    servings_default: params.defaultServings ?? 2,
    recipes: params.recipes,
    recently_used_recipe_ids: recentlyUsedRecipeIds,
    pairing_preference: {
      mode: 'cook_plus_leftovers_blocks',
      blocks: pairBlocks.filter((b) => b.cook_day && b.leftover_day),
      last_solo_day: lastSoloDay || null,
    },
  };
  return `PURPOSE: weekPlan

TASK:
Maak een weekplanning voor de gegeven dagen.

INPUT_JSON:
${JSON.stringify(input)}

OUTPUT_SCHEMA:
${WEEK_PLAN_OUTPUT_SCHEMA}

HARD RULES:
- Retourneer ALLEEN JSON.
- Gebruik uitsluitend recipe_id’s uit INPUT_JSON.
- Als de gebruiker in wishes_text ingrediënten noemt die “nog over zijn / nog liggen / op moeten” (bijv. “ik heb nog wortel”):
  - Ga er standaard van uit dat dit met 1× koken op gaat (dus verwerk het in maximaal 1 kookdag + eventuele restjesdag die daarvan afhangt).
  - Gebruik zulke ingrediënten NIET in alle gerechten, tenzij de gebruiker expliciet zegt dat het veel is of in meerdere gerechten moet.`;
}

