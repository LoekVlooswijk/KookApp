import type { FullRecipe } from './types';
import { formatStepTimerNl } from './timerFormat';
import { formatAiCookProfileForPrompt } from './aiCookProfile';

export const COOKING_SYSTEM_PROMPT_BASE = `Je bent een ervaren kok die helpt tijdens het koken.
Je hebt context over het recept dat de gebruiker aan het maken is.
Geef korte, praktische antwoorden. Maximaal 2–3 zinnen tenzij de gebruiker expliciet om meer detail vraagt.
Antwoord in het Nederlands.`;

export function buildCookingSystemPrompt(recipe: FullRecipe, servings: number): string {
  const lines: string[] = [];
  lines.push(COOKING_SYSTEM_PROMPT_BASE.trim());

  const profileBlock = formatAiCookProfileForPrompt('tipsChat');
  if (profileBlock) {
    lines.push('');
    lines.push(profileBlock);
  }

  lines.push('');
  lines.push('---');
  lines.push('RECEPT (context)');
  lines.push('');
  lines.push(`Aantal personen waarvoor de gebruiker nu kookt: ${servings}`);
  lines.push(`Titel: ${recipe.title}`);
  if (recipe.description?.trim()) {
    lines.push(`Beschrijving: ${recipe.description.trim()}`);
  }
  if (recipe.category?.trim()) {
    lines.push(`Categorie: ${recipe.category.trim()}`);
  }
  if (recipe.tags.length > 0) {
    lines.push(`Tags: ${recipe.tags.join(', ')}`);
  }
  const prep = recipe.prepTimeMin;
  const cook = recipe.cookTimeMin;
  const tot = recipe.totalTimeMin;
  if (prep != null || cook != null || tot != null) {
    const bits: string[] = [];
    if (prep != null) bits.push(`voorbereiding ${prep} min`);
    if (cook != null) bits.push(`koken ${cook} min`);
    if (tot != null) bits.push(`totaal ${tot} min`);
    lines.push(`Tijden: ${bits.join(', ')}`);
  }
  lines.push(`Basisporties in recept: ${recipe.baseServings ?? '?'}`);
  lines.push('');
  lines.push('INGREDIËNTEN');
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
  lines.push('BEREIDINGSSTAPPEN');
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
  lines.push(
    `De gebruiker stelt nu vragen over dit recept. Beantwoord alleen op basis van deze context en algemene kookkennis.

BELANGRIJK — recept aanpassen:
Als de gebruiker aangeeft dat het recept zelf aangepast moet worden voor de volgende keer (bijv. "volgende keer meer knoflook", "dit was te zout", "ik zou meer tijd geven", "doe er next time kaas bij"), bevestig dan het idee en eindig je antwoord met exact de tekst <<AANPASSING>> op een eigen regel.
Doe dit ALLEEN bij echte receptwijzigingen, NIET bij gewone kookvragen of tips.`
  );

  return lines.join('\n');
}
