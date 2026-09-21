import {
  buildAiRepairUserPrompt,
  buildRecipeAdjustSystemPrompt,
  buildRecipeExtractSystemPrompt,
  buildWeekPlanSystemPrompt,
  buildWeekPlanUserPrompt,
  RECIPE_JSON_SCHEMA,
  WEEK_PLAN_OUTPUT_SCHEMA,
} from './aiPromptTemplates';
import {
  buildAdjustChatSystemPrompt,
  buildApplyAdjustmentFromChatSystemPrompt,
} from './recipeAdjust';
import { buildCookingSystemPrompt } from './cookingAssistant';
import {
  DISCOVER_SYSTEM,
  RESOLVE_URLS_SYSTEM,
  RESOLVE_URLS_SYSTEM_WEB,
} from './recipeImportFromPhoto';
import type { FullRecipe } from './types';

export type AiPromptCatalogEntry = {
  id: string;
  title: string;
  /** Korte uitleg: welke data, welke context, welk kookprofiel-onderdeel. */
  contextLines: string[];
  systemPrompt: string;
  /** Uitleg van het gebruikersbericht (user), niet letterlijk de volledige invoer. */
  userRoleNl?: string;
  /** Optioneel voorbeeld of fragment van user-inhoud. */
  userExample?: string;
};

const DEMO_NOW = '2026-01-15T12:00:00.000Z';

/** Minimaal recept om systeemprompts met receptcontext te tonen (geen echte DB-id). */
export function demoRecipeForAiPromptPreview(): FullRecipe {
  return {
    id: 0,
    title: 'Voorbeeld: linzenstoof',
    description: 'Korte demo-omschrijving voor promptvoorbeeld.',
    sourceUrl: null,
    baseServings: 4,
    prepTimeMin: 15,
    cookTimeMin: 35,
    totalTimeMin: 50,
    category: 'Hoofdgerecht',
    dietVegetarian: true,
    dietVegan: false,
    dietKeto: false,
    isFavorite: false,
    wantToTry: false,
    bioScoreColor: null,
    bioScoreUpdatedAt: null,
    bioScoreItems: null,
    notes: null,
    imageUri: null,
    createdAt: DEMO_NOW,
    updatedAt: DEMO_NOW,
    tags: ['vegetarisch', 'budget', 'een pan'],
    ingredientGroups: [
      {
        id: 1,
        recipeId: 0,
        title: null,
        orderIndex: 0,
        ingredients: [
          {
            id: 1,
            recipeId: 0,
            groupId: 1,
            name: 'rode linzen',
            amount: 200,
            unit: 'g',
            orderIndex: 0,
          },
          { id: 2, recipeId: 0, groupId: 1, name: 'ui', amount: 1, unit: 'stuk', orderIndex: 1 },
        ],
      },
    ],
    stepSections: [
      {
        id: 1,
        recipeId: 0,
        title: null,
        orderIndex: 0,
        steps: [
          {
            id: 1,
            recipeId: 0,
            sectionId: 1,
            orderIndex: 0,
            description: 'Fruit de ui.',
            timerSeconds: null,
          },
        ],
      },
    ],
  };
}

/**
 * Vaste lijst AI-prompts in de app (systeemberichten + uitleg user-context).
 * Teksten komen uit dezelfde bouwers als bij echte aanroepen waar mogelijk.
 */
export function getAiPromptCatalog(): AiPromptCatalogEntry[] {
  const demo = demoRecipeForAiPromptPreview();

  const weekUserExample = buildWeekPlanUserPrompt({
    days: ['2026-01-20', '2026-01-21'],
    recipes: [
      {
        id: 1,
        title: demo.title,
        total_time_min: demo.totalTimeMin,
        category: demo.category,
        tags: demo.tags,
        key_ingredients: ['linzen', 'ui'],
        want_to_try: false,
      },
    ],
    wishesText: 'Voorbeeld: graag weinig herhaling, max 45 min op doordeweekse dagen.',
    defaultServings: 2,
    recentlyUsedRecipeIds: [99],
  });

  const repairExample = buildAiRepairUserPrompt({
    purpose: 'weekPlan',
    outputSchema: WEEK_PLAN_OUTPUT_SCHEMA,
    previousOutput: '{ "ok": true, ... }',
    validationErrors: ['Ontbrekende sleutel "plan".', 'Ongeldige recipe_id.'],
  });

  return [
    {
      id: 'cooking_tips',
      title: 'Kooktips & chat',
      contextLines: [
        'Gebruikt tijdens het koken: tab met vragen over het actieve recept.',
        'Het volledige recept (titel, tags, tijden, ingrediënten, stappen) staat in het systeembericht.',
        'Tags kunnen dieetinformatie bevatten (bijv. vegetarisch, vegan) naast andere steekwoorden.',
        'Kookprofiel: schakel “Tips & chat tijdens het koken” aan om MUST NOT / AVOID / PREFER, winkels en extra instructie mee te sturen (doel tipsChat).',
      ],
      systemPrompt: buildCookingSystemPrompt(demo, 2),
      userRoleNl:
        'Daarna volgen alleen chatberichten van jou (user) en antwoorden van de AI. Geen apart “user”-systeemplus; jouw vragen zijn de user-turns.',
    },
    {
      id: 'adjust_chat',
      title: 'Recept aanpassen — chat',
      contextLines: [
        'Scherm om een recept te bespreken met de AI voordat wijzigingen worden doorgevoerd.',
        'Zelfde recepttekst als bij kooktips, plus kookprofiel als “Recept aanpassen” aan staat (doel adjustRecipe).',
      ],
      systemPrompt: buildAdjustChatSystemPrompt(demo),
      userRoleNl:
        'Jouw berichten in de chat zijn de user-turns; het systeembericht blijft hetzelfde tijdens het gesprek.',
    },
    {
      id: 'adjust_apply_chat',
      title: 'Recept aanpassen — chat toepassen (JSON)',
      contextLines: [
        'Laatste stap na het chatten: de AI zet de afspraken om naar één JSON-recept.',
        'Kookprofiel (adjustRecipe) staat in het systeembericht naast het huidige recept als JSON.',
        'De chatgeschiedenis + een vaste slotvraag worden als meerdere user/assistant-turns meegestuurd.',
      ],
      systemPrompt: buildApplyAdjustmentFromChatSystemPrompt(demo),
      userRoleNl:
        'Berichten: eerder user/assistant uit de chat, daarna een vaste user-tekst die vraagt om het volledige recept als JSON volgens het schema.',
      userExample: `… eerdere chat …\n\n(vaste slotvraag o.a.)\nTop, voer de besproken aanpassingen nu door…\nSchema (begin):\n${RECIPE_JSON_SCHEMA.slice(0, 220)}…`,
    },
    {
      id: 'adjust_note_json',
      title: 'Recept aanpassen — notitie → JSON',
      contextLines: [
        'Vanaf het recept: korte notitie (bijv. “minder zout”, “extra groente”) → één AI-call die het hele recept als JSON teruggeeft.',
        'Kookprofiel via buildRecipeAdjustSystemPrompt (doel adjustRecipe): hetzelfde MUST NOT / AVOID / PREFER-blok als bij suggesties, maar alleen als “Recept aanpassen” aan staat.',
      ],
      systemPrompt: buildRecipeAdjustSystemPrompt(),
      userRoleNl:
        'User-bericht bevat het huidige recept als JSON (intern formaat) plus jouw notitie in platte tekst.',
      userExample:
        'Huidige recept (JSON):\n{ "title": "…", … }\n\nNotitie van de gebruiker:\nVoorbeeldnotitie (meer smaak, minder olie).',
    },
    {
      id: 'extract_html',
      title: 'Recept importeren — webpagina → JSON',
      contextLines: [
        'Bij importeren van een URL: gefilterde HTML van die ene pagina wordt naar de AI gestuurd (niet je hele receptenbibliotheek).',
        'Geen kookprofiel in dit systeembericht: het gaat om parseren wat er op de pagina staat.',
      ],
      systemPrompt: buildRecipeExtractSystemPrompt(),
      userRoleNl:
        'User-bericht bevat HTML (en eventueel gemarkeerde JSON-LD-blokken) van die ene receptpagina. Kan groot zijn; de app knipt tot een maximumlengte.',
    },
    {
      id: 'week_plan',
      title: 'Weekplanning — weekmenu',
      contextLines: [
        'Planner: gekozen dagen, beschikbare recepten (id, titel, tags, tijd, …) en jouw vrije wensen.',
        'Standaard porties uit kookprofiel gaan mee in de JSON als servings_default.',
        'Kookprofiel (doel recipeSuggestions): MUST NOT, AVOID, PREFER, winkels, extra instructie én weekplanning-tijdschema als dat veld is ingevuld.',
        'Ook recent gebruikte recept-id’s om herhaling te beperken.',
        'Tags op recepten kunnen dieetlabels reflecteren; het kookprofiel blijft leidend bij tegenstrijdigheden (zie basis-prompt prioriteiten).',
      ],
      systemPrompt: buildWeekPlanSystemPrompt(),
      userRoleNl:
        'User-bericht is buildWeekPlanUserPrompt: gestructureerde JSON met dagen, recepten, wensen, porties en pairing-voorkeur.',
      userExample: weekUserExample,
    },
    {
      id: 'week_plan_repair',
      title: 'Weekplanning / JSON — reparatie',
      contextLines: [
        'Als de eerste JSON-response ongeldig is, stuurt de app opnieuw met hetzelfde systeembericht als weekplanning.',
        'Zelfde geldt voor import en notitie-aanpassing: vergelijkbaar reparatie-user-bericht met schema + fouten + vorige output.',
      ],
      systemPrompt: buildWeekPlanSystemPrompt(),
      userRoleNl:
        'Tweede user-turn (reparatie): vraagt het model om geldige JSON op basis van validatiefouten.',
      userExample: repairExample,
    },
    {
      id: 'photo_discover',
      title: 'Foto importeren — recepten herkennen',
      contextLines: [
        'Vision-call op jouw screenshot: geen kookprofiel; alleen wat op de foto staat.',
      ],
      systemPrompt: DISCOVER_SYSTEM,
      userRoleNl:
        'User-inhoud is de afbeelding zelf (multimodal), geen tekst-user in de klassieke zin.',
    },
    {
      id: 'photo_resolve',
      title: 'Foto importeren — URL’s zoeken',
      contextLines: [
        'Tweede stap: lijst titels + zoekhints uit stap 1 → concrete recept-URL’s of null.',
        'Geen kookprofiel. Variant met web_search gebruikt een ander systeembericht (als web-zoeken aan staat).',
      ],
      systemPrompt: RESOLVE_URLS_SYSTEM,
      userRoleNl: 'User-bericht is JSON met recepten [{ titel, zoekhint }, …] uit de vorige stap.',
      userExample: '{"recepten":[{"titel":"…","zoekhint":"…"}]}',
    },
    {
      id: 'photo_resolve_web',
      title: 'Foto importeren — URL’s (met web)',
      contextLines: [
        'Zelfde taak als “URL’s zoeken”, maar het model mag web_search gebruiken om echte pagina’s te vinden.',
      ],
      systemPrompt: RESOLVE_URLS_SYSTEM_WEB,
      userRoleNl: 'Zelfde JSON-user als zonder web; alleen het systeembericht verschilt.',
    },
  ];
}
