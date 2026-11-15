import type { AiLanguage } from './aiLanguage';
import { formatAiCookProfileForPrompt } from './aiCookProfile';

/** Cap repair-round previous output to limit tokens and accidental large pastes. */
const REPAIR_PREVIOUS_OUTPUT_MAX_CHARS = 14_000;

function truncateForAiRepairPreviousOutput(text: string, lang: AiLanguage = 'nl'): string {
  const t = text.trim();
  if (t.length <= REPAIR_PREVIOUS_OUTPUT_MAX_CHARS) return t;
  const head = Math.floor(REPAIR_PREVIOUS_OUTPUT_MAX_CHARS * 0.55);
  const tail = REPAIR_PREVIOUS_OUTPUT_MAX_CHARS - head - 100;
  const marker =
    lang === 'en'
      ? '[… middle omitted (token/privacy limit) …]'
      : '[… midden weggelaten (token-/privacylimiet) …]';
  return `${t.slice(0, head)}\n\n${marker}\n\n${t.slice(-tail)}`;
}

export type AiPurpose =
  'recipeExtract' | 'adjustRecipe' | 'tipsChat' | 'recipeSuggestions' | 'weekPlan' | 'bioScore';

export const BIO_SCORE_OUTPUT_SCHEMA = `{
  "v": 1,
  "items": [
    { "n": string, "l": "G"|"O"|"R", "p": "L"|"M"|"H" }
  ]
}`;

export const RECIPE_JSON_SCHEMA = `{
  "title": string,
  "description": string | null,
  "base_servings": number,
  "prep_time_min": number | null,
  "cook_time_min": number | null,
  "total_time_min": number | null,
  "category": string | null,
  "bio_score_color": "red"|"orange"|"green"|null,
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

const AI_BASE_SYSTEM_PROMPT: Record<AiLanguage, string> = {
  nl: `Je bent een kook-assistent in een privacy-first app.
Antwoord altijd in het Nederlands.

Volg deze prioriteiten bij conflicts:
1) MUST NOT (allergie/verboden) > alles
2) Dieetregels > voorkeuren
3) Tijdschema/beschikbaarheid > variatie/creativiteit
4) Gebruikersvoorkeuren (PREFER) > hergebruik ingrediënten
5) Hergbruik ingrediënten > variatie`,
  en: `You are a cooking assistant in a privacy-first app.
Always answer in English.

Follow these priorities in case of conflicts:
1) MUST NOT (allergy/forbidden) > everything
2) Diet rules > preferences
3) Time schedule/availability > variation/creativity
4) User preferences (PREFER) > ingredient reuse
5) Ingredient reuse > variation`,
};

const JSON_ONLY_RULE: Record<AiLanguage, string> = {
  nl: 'Output-regel: retourneer ALLEEN geldige JSON. Geen markdown, geen uitleg, geen tekst ervoor of erna.',
  en: 'Output rule: return ONLY valid JSON. No markdown, no explanation, no text before or after it.',
};

type BuildSystemPromptParams = {
  purpose: AiPurpose;
  /** Set to true for structured outputs where we need strict JSON. */
  jsonOnly?: boolean;
  /** AI volgt de app-taal; default Nederlands. */
  lang?: AiLanguage;
  /** Extra purpose-specifieke instructies per taal. */
  instructions?: Partial<Record<AiLanguage, string>>;
};

export function buildAiSystemPrompt(params: BuildSystemPromptParams): string {
  const lang = params.lang ?? 'nl';
  const lines: string[] = [];
  lines.push(AI_BASE_SYSTEM_PROMPT[lang].trim());
  lines.push('');

  if (params.jsonOnly) {
    lines.push(JSON_ONLY_RULE[lang]);
    lines.push('');
  }

  if (params.instructions?.[lang]?.trim()) {
    lines.push((params.instructions[lang] ?? '').trim());
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
    const block = formatAiCookProfileForPrompt(profilePurpose, lang);
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
  /** AI volgt de app-taal; default Nederlands. */
  lang?: AiLanguage;
};

/**
 * A follow-up prompt for when the previous structured output was invalid.
 * Use this with the same system prompt (or a stricter "JSON only" system prompt) and call the model once more.
 */
export function buildAiRepairUserPrompt(params: BuildRepairPromptParams): string {
  const lang = params.lang ?? 'nl';
  const intro =
    lang === 'en'
      ? 'Your previous answer was invalid or broke the rules. Fix it.'
      : 'Je vorige antwoord was ongeldig of schond regels. Repareer het.';
  const noDetails = lang === 'en' ? '- (no details available)' : '- (geen details beschikbaar)';
  const outro =
    lang === 'en'
      ? 'Return again ONLY JSON that exactly matches the schema.'
      : 'Retourneer opnieuw ALLEEN JSON dat exact voldoet aan het schema.';
  const errs = (params.validationErrors ?? []).map((e) => e.trim()).filter(Boolean);
  const lines: string[] = [];
  lines.push(intro);
  lines.push('');
  lines.push('VALIDATION_ERRORS:');
  if (errs.length === 0) {
    lines.push(noDetails);
  } else {
    for (const e of errs) lines.push(`- ${e}`);
  }
  lines.push('');
  lines.push('REQUIRED_OUTPUT_SCHEMA:');
  lines.push(params.outputSchema.trim());
  lines.push('');
  lines.push('PREVIOUS_OUTPUT:');
  lines.push(truncateForAiRepairPreviousOutput(params.previousOutput, lang));
  lines.push('');
  lines.push(outro);
  return lines.join('\n').trim();
}

export function buildRecipeExtractSystemPrompt(lang: AiLanguage = 'nl'): string {
  return buildAiSystemPrompt({
    purpose: 'recipeExtract',
    jsonOnly: true,
    lang,
    instructions: {
      nl: `Je bent een recept-parser. Extraheer het recept uit de volgende HTML en retourneer ALLEEN één JSON-object (geen markdown, geen uitleg ervoor of erna) in exact dit schema:

Schema:
${RECIPE_JSON_SCHEMA}

Regels:
- Als de invoer een sectie "JSONLD_BLOCKS" bevat: gebruik die embedded JSON-LD (vaak schema.org/Recipe) als primaire bron voor titel, ingrediënten en bereiding; vul aan met zichtbare HTML waar nodig.
- Normaliseer eenheden: gebruik g, kg, ml, l, el, tl, stuk(s), teen, plak, tak, blad, snuf, of "naar smaak" waar passend.
- Groepeer ingrediënten als de pagina duidelijke secties heeft.
- Schat prep_time_min, cook_time_min, total_time_min als ze niet expliciet staan.
- timer_seconds: altijd een geheel aantal seconden (bijv. 30, 90; geen breuken in minuten zoals 0,5).
- Alle teksten in het Nederlands als de bron Nederlands is.
- Tags ("tags"): maximaal 6–8 nuttige steekwoorden die het recept karakteriseren.
    Gebruik UITSLUITEND tags die daadwerkelijk helpen bij categoriseren en zoeken.

    **Toegestaan (en standaardiseer altijd naar Nederlands):**
    - Keuken: italiaans, frans, aziatisch, nederlands, mediterraan, mexicaans, thais, indisch
    - Dieet: vegetarisch, vegan, glutenvrij, lactosevrij, keto, suikervrij
    - Techniek: oven, gebakken, gefrituurd, gegrild, gestomd, gebraden, geroerbakt, rauwe, koud
    - Seizoen: zomer, lente, herfst, winter
    - Gang: hoofdgerecht, voorgerecht, nagerecht, bijgerecht, tussengerecht
    - Hoofdingrediënt: kip, rund, varkensvlees, vis, zeevruchten, groente, pasta, rijst, aardappel
      (alleen als het de belangrijkste component is, niet voor elke ingrediënt)

    **Absoluut NIET genereren (deze informatie staat al in aparte velden):**
    - Numerieke portie-aantallen: "4 porties", "2 personen", "6 stuks", "1-2 porties", "4-6 personen"
    - Bereidingstijden: "30 minuten", "1 uur", "2 uren", "45 min", "15 minuten"

    **Absoluut NIET genereren (geen zoekwaarde of redundant):**
    - Generieke complimenten: lekker, heerlijk, delicious, tasty, yummy, smakelijk
    - Moeilijkheidsgraad: makkelijk, simpel, eenvoudig, snel, moeilijk, ingewikkeld, gemiddeld
    - Winkel/merk namen: ah, albert heijn, jumbo, lidl, plus, coop, dirk, ekoplaza
    - Algemene recept woorden: recept, recepten, receptje, kookrecept
    - Algemene kooktermen: koken, kook, bereiden, maken

    **Standaardisatie regels:**
    - Gebruik ALTIJD Nederlandse termen: "zomer" niet "summer", "italiaans" niet "italian", "gegrild" niet "grilled"
    - Voor avondmaaltijd: gebruik "hoofdgerecht" niet "diner", "avondeten" of "avondmaaltijd"
    - Vegetarisch vs vegan: "vegetarisch" voor vlees/vis-vrij, "vegan" ALLEEN voor 100% plantaardig (geen dierlijke producten)
    - Geen combinatie van maaltijdmoment (lunch, ontbijt, brunch, borrel, middageten) met gang (hoofdgerecht, voorgerecht, nagerecht, bijgerecht, tussengerecht)`,
      en: `You are a recipe parser. Extract the recipe from the following HTML and return ONLY one JSON object (no markdown, no explanation before or after) in exactly this schema:

Schema:
${RECIPE_JSON_SCHEMA}

Rules:
- If the input contains a "JSONLD_BLOCKS" section: use that embedded JSON-LD (often schema.org/Recipe) as the primary source for title, ingredients and preparation; supplement with the visible HTML where needed.
- Normalise units: use g, kg, ml, l, tbsp, tsp, piece(s), clove, slice, sprig, leaf, pinch, or "to taste" where appropriate.
- Group ingredients if the page has clear sections.
- Estimate prep_time_min, cook_time_min, total_time_min if they are not stated explicitly.
- timer_seconds: always a whole number of seconds (e.g. 30, 90; no fractions of minutes such as 0.5).
- All text in English; if the source is in another language, translate it into natural English.
- Tags ("tags"): at most 6–8 useful keywords that characterise the recipe.
    Use ONLY tags that genuinely help with categorising and searching.

    **Allowed (and always standardise to English):**
    - Cuisine: italian, french, asian, dutch, mediterranean, mexican, thai, indonesian
    - Diet: vegetarian, vegan, gluten-free, dairy-free, keto, sugar-free
    - Technique: oven, baked, fried, grilled, steamed, roasted, stir-fried, raw, cold
    - Season: summer, spring, autumn, winter
    - Course: main course, starter, dessert, side dish, in-between course
    - Main ingredient: chicken, beef, pork, fish, seafood, vegetable, pasta, rice, potato
      (only if it is the most important component, not for every ingredient)

    **Never generate (this information already lives in separate fields):**
    - Numeric serving counts: "4 servings", "2 people", "6 pieces", "1-2 servings", "4-6 people"
    - Preparation times: "30 minutes", "1 hour", "2 hours", "45 min", "15 minutes"

    **Never generate (no search value or redundant):**
    - Generic compliments: delicious, tasty, yummy, lovely, lekker, heerlijk, smakelijk
    - Difficulty: easy, simple, quick, difficult, complicated, medium, makkelijk, snel
    - Shop/brand names: ah, albert heijn, jumbo, lidl, plus, coop, dirk, ekoplaza, tesco, sainsbury's, asda, morrisons, aldi, waitrose
    - Generic recipe words: recipe, recipes, dish, gerecht, recept
    - Generic cooking terms: cooking, cook, prepare, make, koken, bereiden

    **Standardisation rules:**
    - ALWAYS use English terms: "summer" not "zomer", "italian" not "italiaans", "grilled" not "gegrild"
    - For an evening meal: use "main course" not "dinner" or "evening meal"
    - Vegetarian vs vegan: "vegetarian" for meat/fish-free, "vegan" ONLY for 100% plant-based (no animal products)
    - Do not combine a meal moment (lunch, breakfast, brunch, drinks, midday meal) with a course (main course, starter, dessert, side dish, in-between course)`,
    },
  });
}

/**
 * OCR/vision stap voor receptfoto’s: transcribeer tekst zo letterlijk mogelijk.
 * Output is plain text (geen JSON), zodat we daarna met een tweede (text-only) stap naar JSON kunnen.
 */
export function buildRecipePhotoOcrSystemPrompt(lang: AiLanguage = 'nl'): string {
  return buildAiSystemPrompt({
    purpose: 'recipeExtract',
    jsonOnly: false,
    lang,
    instructions: {
      nl: `Je helpt bij het importeren van een recept uit een foto (boek/print/screenshot).

Taak:
- Schrijf alle leesbare recepttekst uit de afbeelding over als PLAIN TEXT.
- Behoud regelafbrekingen en kopjes (bijv. "Ingrediënten", "Bereiding", "Voor de saus") waar zichtbaar.
- Neem hoeveelheden, eenheden en tijden letterlijk over (bijv. "200 g", "1 el", "20 min").
- Als tekst deels onleesbaar is: laat het weg (niet gokken) of markeer met "…".

Regels:
- GEEN JSON.
- GEEN markdown.
- GEEN uitleg; alleen de getranscribeerde tekst.`,
      en: `You are helping to import a recipe from a photo (book/print/screenshot).

Task:
- Transcribe all readable recipe text from the image as PLAIN TEXT.
- Keep line breaks and headings (e.g. "Ingredients", "Preparation", "For the sauce") where visible.
- Copy quantities, units and times over literally (e.g. "200 g", "1 tbsp", "20 min").
- If part of the text is illegible: leave it out (do not guess) or mark it with "…".

Rules:
- NO JSON.
- NO markdown.
- NO explanation; only the transcribed text.`,
    },
  });
}

/**
 * Tweede stap voor receptfoto’s: van (mogelijk rommelige) OCR-tekst naar strict JSON schema.
 */
export function buildRecipeExtractFromOcrTextSystemPrompt(lang: AiLanguage = 'nl'): string {
  return buildAiSystemPrompt({
    purpose: 'recipeExtract',
    jsonOnly: true,
    lang,
    instructions: {
      nl: `Je bent een recept-parser.
Je krijgt OCR-tekst die uit één of meerdere foto’s is getranscribeerd.
Extraheer het recept uit die tekst en retourneer ALLEEN één JSON-object (geen markdown, geen uitleg ervoor of erna) in exact dit schema:

Schema:
${RECIPE_JSON_SCHEMA}

Regels:
- Normaliseer eenheden: gebruik g, kg, ml, l, el, tl, stuk(s), teen, plak, tak, blad, snuf, of "naar smaak" waar passend.
- Groepeer ingrediënten als de tekst duidelijke secties heeft.
- Schat prep_time_min, cook_time_min, total_time_min als ze niet expliciet staan.
- timer_seconds: altijd een geheel aantal seconden (bijv. 30, 90; geen breuken in minuten zoals 0,5).
- Alle teksten in het Nederlands.
- Tags ("tags"): maximaal 6–8 nuttige steekwoorden die het recept karakteriseren.
    Gebruik UITSLUITEND tags die daadwerkelijk helpen bij categoriseren en zoeken.

    **Toegestaan (en standaardiseer altijd naar Nederlands):**
    - Keuken: italiaans, frans, aziatisch, nederlands, mediterraan, mexicaans, thais, indisch
    - Dieet: vegetarisch, vegan, glutenvrij, lactosevrij, keto, suikervrij
    - Techniek: oven, gebakken, gefrituurd, gegrild, gestomd, gebraden, geroerbakt, rauwe, koud
    - Seizoen: zomer, lente, herfst, winter
    - Gang: hoofdgerecht, voorgerecht, nagerecht, bijgerecht, tussengerecht
    - Hoofdingrediënt: kip, rund, varkensvlees, vis, zeevruchten, groente, pasta, rijst, aardappel
      (alleen als het de belangrijkste component is, niet voor elke ingrediënt)

    **Absoluut NIET genereren (deze informatie staat al in aparte velden):**
    - Numerieke portie-aantallen: "4 porties", "2 personen", "6 stuks", "1-2 porties", "4-6 personen"
    - Bereidingstijden: "30 minuten", "1 uur", "2 uren", "45 min", "15 minuten"

    **Absoluut NIET genereren (geen zoekwaarde of redundant):**
    - Generieke complimenten: lekker, heerlijk, delicious, tasty, yummy, smakelijk
    - Moeilijkheidsgraad: makkelijk, simpel, eenvoudig, snel, moeilijk, ingewikkeld, gemiddeld
    - Winkel/merk namen: ah, albert heijn, jumbo, lidl, plus, coop, dirk, ekoplaza
    - Algemene recept woorden: recept, recepten, receptje, kookrecept
    - Algemene kooktermen: koken, kook, bereiden, maken

    **Standaardisatie regels:**
    - Gebruik ALTIJD Nederlandse termen: "zomer" niet "summer", "italiaans" niet "italian", "gegrild" niet "grilled"
    - Voor avondmaaltijd: gebruik "hoofdgerecht" niet "diner", "avondeten" of "avondmaaltijd"
    - Vegetarisch vs vegan: "vegetarisch" voor vlees/vis-vrij, "vegan" ALLEEN voor 100% plantaardig (geen dierlijke producten)
    - Geen combinatie van maaltijdmoment (lunch, ontbijt, brunch, borrel, middageten) met gang (hoofdgerecht, voorgerecht, nagerecht, bijgerecht, tussengerecht)`,
      en: `You are a recipe parser.
You receive OCR text transcribed from one or more photos.
Extract the recipe from that text and return ONLY one JSON object (no markdown, no explanation before or after) in exactly this schema:

Schema:
${RECIPE_JSON_SCHEMA}

Rules:
- Normalise units: use g, kg, ml, l, tbsp, tsp, piece(s), clove, slice, sprig, leaf, pinch, or "to taste" where appropriate.
- Group ingredients if the text has clear sections.
- Estimate prep_time_min, cook_time_min, total_time_min if they are not stated explicitly.
- timer_seconds: always a whole number of seconds (e.g. 30, 90; no fractions of minutes such as 0.5).
- All text in English.
- Tags ("tags"): at most 6–8 useful keywords that characterise the recipe.
    Use ONLY tags that genuinely help with categorising and searching.

    **Allowed (and always standardise to English):**
    - Cuisine: italian, french, asian, dutch, mediterranean, mexican, thai, indonesian
    - Diet: vegetarian, vegan, gluten-free, dairy-free, keto, sugar-free
    - Technique: oven, baked, fried, grilled, steamed, roasted, stir-fried, raw, cold
    - Season: summer, spring, autumn, winter
    - Course: main course, starter, dessert, side dish, in-between course
    - Main ingredient: chicken, beef, pork, fish, seafood, vegetable, pasta, rice, potato
      (only if it is the most important component, not for every ingredient)

    **Never generate (this information already lives in separate fields):**
    - Numeric serving counts: "4 servings", "2 people", "6 pieces", "1-2 servings", "4-6 people"
    - Preparation times: "30 minutes", "1 hour", "2 hours", "45 min", "15 minutes"

    **Never generate (no search value or redundant):**
    - Generic compliments: delicious, tasty, yummy, lovely, lekker, heerlijk, smakelijk
    - Difficulty: easy, simple, quick, difficult, complicated, medium, makkelijk, snel
    - Shop/brand names: ah, albert heijn, jumbo, lidl, plus, coop, dirk, ekoplaza, tesco, sainsbury's, asda, morrisons, aldi, waitrose
    - Generic recipe words: recipe, recipes, dish, gerecht, recept
    - Generic cooking terms: cooking, cook, prepare, make, koken, bereiden

    **Standardisation rules:**
    - ALWAYS use English terms: "summer" not "zomer", "italian" not "italiaans", "grilled" not "gegrild"
    - For an evening meal: use "main course" not "dinner" or "evening meal"
    - Vegetarian vs vegan: "vegetarian" for meat/fish-free, "vegan" ONLY for 100% plant-based (no animal products)
    - Do not combine a meal moment (lunch, breakfast, brunch, drinks, midday meal) with a course (main course, starter, dessert, side dish, in-between course)`,
    },
  });
}

export function buildRecipeAdjustSystemPrompt(lang: AiLanguage = 'nl'): string {
  return buildAiSystemPrompt({
    purpose: 'adjustRecipe',
    jsonOnly: true,
    lang,
    instructions: {
      nl: `De gebruiker heeft een notitie geschreven over een recept.
Pas het recept aan op basis van de notitie.
Retourneer het VOLLEDIGE aangepaste recept in hetzelfde JSON-schema als hieronder.
Wijzig ALLEEN wat de notitie impliceert; behoud overige onderdelen waar mogelijk.

Belangrijk (kooklogica):
- Als een wijziging invloed heeft op techniek (volgorde, temperatuur, timing, “even bakken/frituren”, toevoegen van vloeistof, etc.), pas dan ook de bereidingsstappen aan zodat het culinair klopt.
- Je mag stappen herschikken, splitsen of samenvoegen als dat nodig is voor correcte techniek, maar beperk je tot wat de notitie logisch veroorzaakt.

Schema:
${RECIPE_JSON_SCHEMA}`,
      en: `The user has written a note about a recipe.
Adjust the recipe based on the note.
Return the FULL adjusted recipe in the same JSON schema as below.
Change ONLY what the note implies; keep the remaining parts where possible.

Important (cooking logic):
- If a change affects technique (order, temperature, timing, "briefly bake/fry", adding liquid, etc.), also adjust the preparation steps so the result is culinarily correct.
- You may reorder, split or merge steps if necessary for a correct technique, but limit yourself to what the note logically causes.

Schema:
${RECIPE_JSON_SCHEMA}`,
    },
  });
}

export function buildWeekPlanSystemPrompt(lang: AiLanguage = 'nl'): string {
  return buildAiSystemPrompt({
    purpose: 'weekPlan',
    jsonOnly: true,
    lang,
    instructions: {
      nl: `Je helpt met weekplanning voor maaltijden (alleen diner).
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
      en: `You help with weekly meal planning (dinner only).
You get a list of days and a list of available recipes (with ids).
Take into account the user's wishes and the time schedule / availability from the cooking profile.

Output:
- Return one JSON object according to this schema:
${WEEK_PLAN_OUTPUT_SCHEMA}

Rules:
- Use only recipe_id's that appear in the input.
- Each date must appear exactly once in "plan".
- Servings:
  - "servings" means the number of eaters for that day (so usually equal to servings_default, unless the user asks for something else).
  - With "cooks_for_days" > 1 you cook extra IN ADVANCE, but "servings" stays the same (do not double it).
- Leftovers (cooking for 2 days at once):
  - HARD RULE: try to plan the week as much as possible in 2-day blocks: cooking day + leftover day after it.
    - Example: days 1–2 together, 3–4 together, 5–6 together, etc. (the last day may be solo).
  - PREFER: plan leftovers preferably on the directly following selected day(s) (so without gaps).
    - If you do use a gap (e.g. because only one cooking day is possible), do so sparingly and explain briefly in "rationale" and/or "unsatisfied_constraints".
  - On the cooking day, set "cooks_for_days" to 2 or 3.
  - For the following day(s) that are leftovers: set "leftover_of_date" to the cooking day (YYYY-MM-DD) and set "cooks_for_days" to 1.
  - Leftover days must not generate new leftovers (so no cooks_for_days > 1 when leftover_of_date is set).
- Variation (against repetition):
  - HARD RULE: do not use the same recipe more than once as "cooking fresh" within the selected days.
  - Repetition is only allowed when it is explicitly a leftover day (leftover_of_date set).
  - HARD RULE: if INPUT_JSON contains "recently_used_recipe_ids": avoid those recipes as "cooking fresh".
    - Only if there are too few unique options may you deviate from this; then put a clear reason in "unsatisfied_constraints".
- If the user explicitly asks to add a new recipe (e.g. "add a new recipe: ..."):
  - You may create at most 2 new recipes in "new_recipes".
  - In "plan", use "recipe_id" as a string: the "temp_id" of the new recipe.
  - If the user does not ask this: leave "new_recipes" out or empty.
- If something is impossible: fill "unsatisfied_constraints" with concrete reasons, but still provide a best-effort plan.`,
    },
  });
}

export function buildBioScoreSystemPrompt(lang: AiLanguage = 'nl'): string {
  return buildAiSystemPrompt({
    purpose: 'bioScore',
    jsonOnly: true,
    lang,
    instructions: {
      nl: `Je beoordeelt ingrediënten voor een bio-score in een kookapp.
Je krijgt een lijst met ingredient-namen (losse woorden/phrases).

Taak:
- Beoordeel ALLEEN ingrediënten die duidelijk groente of fruit zijn.
- Negeer alles dat geen groente/fruit is (vlees/vis/zuivel/granen/olie/kruiden/specerijen/water/zout/etc). Zet die NIET in de output.
- Retourneer ALLEEN JSON volgens het schema hieronder.

Herkomst buckets (l):
- "G": NL/BE/DE (groen)
- "O": rest van Europa (oranje)
- "R": wereld/elders (buiten Europa) (rood)
- Als herkomst onbekend is: kies de meest waarschijnlijke bucket (default "O"), tenzij het ingrediënt bijna altijd NL/BE/DE is.

Pesticiden (p):
- "L": geen/heel weinig
- "M": wat
- "H": veel

OUTPUT_SCHEMA:
${BIO_SCORE_OUTPUT_SCHEMA}`,
      en: `You assess ingredients for a bio score in a cooking app.
You get a list of ingredient names (loose words/phrases).

Task:
- Assess ONLY ingredients that are clearly vegetables or fruit.
- Ignore anything that is not a vegetable/fruit (meat/fish/dairy/grains/oil/herbs/spices/water/salt/etc.). Do NOT put those in the output.
- Return ONLY JSON according to the schema below.

Origin buckets (l):
- "G": NL/BE/DE (green)
- "O": rest of Europe (orange)
- "R": world/elsewhere (outside Europe) (red)
- If the origin is unknown: pick the most likely bucket (default "O"), unless the ingredient is almost always from NL/BE/DE.

Pesticides (p):
- "L": none/very little
- "M": some
- "H": a lot

OUTPUT_SCHEMA:
${BIO_SCORE_OUTPUT_SCHEMA}`,
    },
  });
}

export function buildBioScoreUserPrompt(ingredients: string[]): string {
  const list = (Array.isArray(ingredients) ? ingredients : [])
    .map((x) => (typeof x === 'string' ? x.trim() : ''))
    .filter(Boolean)
    .slice(0, 40);
  return `PURPOSE: bioScore

INGREDIENTS:
${JSON.stringify(list)}`;
}

export function buildWeekPlanUserPrompt(params: {
  currentDate?: string;
  days: string[];
  recipes: {
    id: number;
    title: string;
    total_time_min?: number | null;
    category?: string | null;
    tags?: string[];
    key_ingredients?: string[];
    want_to_try?: boolean;
  }[];
  wishesText?: string;
  defaultServings?: number;
  recentlyUsedRecipeIds?: number[];
  /** When the prompt embeds a capped subset of the library, tell the model what happened. */
  selectionMeta?: { totalInLibrary: number; includedInPrompt: number };
  /** AI volgt de app-taal; default Nederlands. */
  lang?: AiLanguage;
}): string {
  const lang = params.lang ?? 'nl';
  const taskLine =
    lang === 'en'
      ? 'Create a meal plan for the given days.'
      : 'Maak een weekplanning voor de gegeven dagen.';
  const days = Array.isArray(params.days) ? params.days : [];
  const pairBlocks: { cook_day: string; leftover_day: string }[] = [];
  const soloDays: string[] = [];
  const isIsoDate = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s);
  const daysNorm = days
    .map((d) => (typeof d === 'string' ? d.trim() : ''))
    .filter((d) => isIsoDate(d));
  // Only pair within consecutive calendar-day runs.
  // For odd-length runs: make the FIRST day solo, so cooking days cluster (e.g. 3 days -> solo day1, pair day2-3).
  // This prevents "cook once, then 2-3 days nothing, then cook again" patterns.
  const asDateMs = (dateOnly: string): number => {
    const [y, m, d] = dateOnly.split('-').map((x) => Number.parseInt(x, 10));
    return new Date(y, (m ?? 1) - 1, d ?? 1).getTime();
  };
  const dayDiff = (a: string, b: string): number =>
    Math.round((asDateMs(a) - asDateMs(b)) / (24 * 60 * 60 * 1000));
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
  const lastSoloDay = soloDays.length > 0 ? (soloDays[soloDays.length - 1] ?? '') : '';
  const recent = Array.isArray(params.recentlyUsedRecipeIds) ? params.recentlyUsedRecipeIds : [];
  const recentlyUsedRecipeIds = Array.from(
    new Set(
      recent
        .map((x) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x) : -1))
        .filter((x) => x > 0)
    )
  ).slice(0, 40);
  const sel = params.selectionMeta;
  const currentDate = typeof params.currentDate === 'string' ? params.currentDate.trim() : '';
  const input = {
    current_date: currentDate || null,
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
    ...(sel && sel.totalInLibrary > sel.includedInPrompt
      ? {
          selection_meta: {
            total_in_library: sel.totalInLibrary,
            included_in_prompt: sel.includedInPrompt,
            note_nl:
              lang === 'en'
                ? 'Your full recipe library is not in this list; only the recipes below have been included (favourites and recent ones first). Use only recipe_id’s from recipes.'
                : 'Niet je volledige receptenbibliotheek staat in deze lijst; alleen onderstaande recepten zijn meegestuurd (favorieten en recent eerst). Gebruik alleen recipe_id’s uit recipes.',
          },
        }
      : {}),
  };
  const hardRules =
    lang === 'en'
      ? `- Return ONLY JSON.
- Use only recipe_id’s from INPUT_JSON.
- If the user mentions ingredients in wishes_text that are “left over / still in the fridge / need using up” (e.g. “I still have some carrots” or “ik heb nog wortel”):
  - By default, assume these are used up with 1x cooking (so work them into at most 1 cooking day + any leftover day depending on it).
  - Do NOT use such ingredients in every dish, unless the user explicitly says there is a lot of it or it must go into several dishes.`
      : `- Retourneer ALLEEN JSON.
- Gebruik uitsluitend recipe_id’s uit INPUT_JSON.
- Als de gebruiker in wishes_text ingrediënten noemt die “nog over zijn / nog liggen / op moeten” (bijv. “ik heb nog wortel”):
  - Ga er standaard van uit dat dit met 1× koken op gaat (dus verwerk het in maximaal 1 kookdag + eventuele restjesdag die daarvan afhangt).
  - Gebruik zulke ingrediënten NIET in alle gerechten, tenzij de gebruiker expliciet zegt dat het veel is of in meerdere gerechten moet.`;

  return `PURPOSE: weekPlan

TASK:
${taskLine}

INPUT_JSON:
${JSON.stringify(input)}

OUTPUT_SCHEMA:
${WEEK_PLAN_OUTPUT_SCHEMA}

HARD RULES:
${hardRules}`;
}
