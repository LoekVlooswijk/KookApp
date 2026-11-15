import type { FullRecipe } from './types';
import type { AiLanguage } from './aiLanguage';
import { formatStepTimerNl } from './timerFormat';
import { formatAiCookProfileForPrompt } from './aiCookProfile';

const COOKING_SYSTEM_PROMPT_BASE: Record<AiLanguage, string> = {
  nl: `Je bent een ervaren kok die helpt tijdens het koken.
Je hebt context over het recept dat de gebruiker aan het maken is.
Geef korte, praktische antwoorden. Maximaal 2–3 zinnen tenzij de gebruiker expliciet om meer detail vraagt.
Antwoord in het Nederlands.`,
  en: `You are an experienced cook helping out during cooking.
You have context about the recipe the user is making.
Give short, practical answers. At most 2–3 sentences unless the user explicitly asks for more detail.
Answer in English.`,
};

type AssistantLabels = {
  systemBase: string;
  recipeHeader: string;
  servingsLine: (servings: number) => string;
  title: string;
  description: string;
  category: string;
  tags: string;
  times: string;
  timesBits: {
    prep: (n: number) => string;
    cook: (n: number) => string;
    total: (n: number) => string;
  };
  baseServings: (n: number | null) => string;
  ingredientsHeader: string;
  stepsHeader: string;
  closing: (profileBlockPresent: boolean) => string;
};

const ASSISTANT_LABELS: Record<AiLanguage, AssistantLabels> = {
  nl: {
    systemBase: COOKING_SYSTEM_PROMPT_BASE.nl,
    recipeHeader: 'RECEPT (context)',
    servingsLine: (n) => `Aantal personen waarvoor de gebruiker nu kookt: ${n}`,
    title: 'Titel',
    description: 'Beschrijving',
    category: 'Categorie',
    tags: 'Tags',
    times: 'Tijden',
    timesBits: {
      prep: (n) => `voorbereiding ${n} min`,
      cook: (n) => `koken ${n} min`,
      total: (n) => `totaal ${n} min`,
    },
    baseServings: (n) => `Basisporties in recept: ${n ?? '?'}`,
    ingredientsHeader: 'INGREDIËNTEN',
    stepsHeader: 'BEREIDINGSSTAPPEN',
    closing: () =>
      `De gebruiker stelt nu vragen over dit recept. Beantwoord alleen op basis van deze context en algemene kookkennis.

BELANGRIJK — recept aanpassen:
Als de gebruiker aangeeft dat het recept zelf aangepast moet worden voor de volgende keer (bijv. "volgende keer meer knoflook", "dit was te zout", "ik zou meer tijd geven", "doe er next time kaas bij"), bevestig dan het idee en eindig je antwoord met exact de tekst <<AANPASSING>> op een eigen regel.
Doe dit ALLEEN bij echte receptwijzigingen, NIET bij gewone kookvragen of tips.`,
  },
  en: {
    systemBase: COOKING_SYSTEM_PROMPT_BASE.en,
    recipeHeader: 'RECIPE (context)',
    servingsLine: (n) => `Number of people the user is currently cooking for: ${n}`,
    title: 'Title',
    description: 'Description',
    category: 'Category',
    tags: 'Tags',
    times: 'Times',
    timesBits: {
      prep: (n) => `preparation ${n} min`,
      cook: (n) => `cooking ${n} min`,
      total: (n) => `total ${n} min`,
    },
    baseServings: (n) => `Base servings in the recipe: ${n ?? '?'}`,
    ingredientsHeader: 'INGREDIENTS',
    stepsHeader: 'PREPARATION STEPS',
    closing: () =>
      `The user is now asking questions about this recipe. Answer only from this context and general cooking knowledge.

IMPORTANT — adjusting the recipe:
If the user indicates that the recipe itself should be changed for next time (e.g. "more garlic next time", "this was too salty", "I would give it more time", "add cheese next time"), acknowledge the idea and end your answer with exactly the text <<AANPASSING>> on its own line.
Do this ONLY for actual recipe changes, NOT for ordinary cooking questions or tips.`,
  },
};

export function buildCookingSystemPrompt(
  recipe: FullRecipe,
  servings: number,
  lang: AiLanguage = 'nl'
): string {
  const L = ASSISTANT_LABELS[lang];
  const lines: string[] = [];
  lines.push(L.systemBase.trim());

  const profileBlock = formatAiCookProfileForPrompt('tipsChat', lang);
  if (profileBlock) {
    lines.push('');
    lines.push(profileBlock);
  }

  lines.push('');
  lines.push('---');
  lines.push(L.recipeHeader);
  lines.push('');
  lines.push(L.servingsLine(servings));
  lines.push(`${L.title}: ${recipe.title}`);
  if (recipe.description?.trim()) {
    lines.push(`${L.description}: ${recipe.description.trim()}`);
  }
  if (recipe.category?.trim()) {
    lines.push(`${L.category}: ${recipe.category.trim()}`);
  }
  if (recipe.tags.length > 0) {
    lines.push(`${L.tags}: ${recipe.tags.join(', ')}`);
  }
  const prep = recipe.prepTimeMin;
  const cook = recipe.cookTimeMin;
  const tot = recipe.totalTimeMin;
  if (prep != null || cook != null || tot != null) {
    const bits: string[] = [];
    if (prep != null) bits.push(L.timesBits.prep(prep));
    if (cook != null) bits.push(L.timesBits.cook(cook));
    if (tot != null) bits.push(L.timesBits.total(tot));
    lines.push(`${L.times}: ${bits.join(', ')}`);
  }
  lines.push(L.baseServings(recipe.baseServings));
  lines.push('');
  lines.push(L.ingredientsHeader);
  for (const g of recipe.ingredientGroups) {
    if (g.title?.trim()) lines.push(`[${g.title.trim()}]`);
    for (const i of g.ingredients) {
      const qty = [i.amount != null ? String(i.amount) : '', i.unit?.trim() ?? '']
        .filter(Boolean)
        .join(' ');
      lines.push(qty ? `- ${qty} ${i.name}` : `- ${i.name}`);
    }
  }
  lines.push('');
  lines.push(L.stepsHeader);
  let stepNum = 1;
  for (const s of recipe.stepSections) {
    if (s.title?.trim()) lines.push(`[${s.title.trim()}]`);
    for (const st of s.steps) {
      const timer =
        st.timerSeconds != null && st.timerSeconds > 0
          ? ` (timer: ${formatStepTimerNl(st.timerSeconds)})`
          : '';
      lines.push(`${stepNum}. ${st.description}${timer}`);
      stepNum++;
    }
  }
  lines.push('');
  lines.push(L.closing(profileBlock != null));

  return lines.join('\n');
}
