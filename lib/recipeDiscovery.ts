/** Recipe discovery using AI to find relevant recipes from user's database. */

import { callAiText } from './aiClient';
import { listRecipes } from './recipesRepo';

export type DiscoveredRecipe = {
  id: number;
  title: string;
};

/** Format recipes for AI consumption - only include id, title, tags, and category (no description) */
function formatRecipesForAi(
  recipes: { id: number; title: string; tags?: string[]; category?: string | null }[]
): string {
  // Leesbare platte lijst i.p.v. één gecomprimeerde JSON-regel: robuuster voor het model.
  return recipes
    .map((r) => {
      const bits = [r.category?.trim() ?? '', (r.tags ?? []).join(', ')]
        .filter((x) => x.length > 0)
        .join(' | ');
      return bits ? `${r.id} | ${r.title} | ${bits}` : `${r.id} | ${r.title}`;
    })
    .join('\n');
}

/** Parse AI response to extract recipe IDs */
function parseDiscoverResponse(text: string): number[] {
  // Try to extract JSON array of IDs
  // AI should return format like: [1, 5, 3] or { matches: [1, 5, 3] } or { ids: [1, 5, 3] }
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.filter((n: unknown) => typeof n === 'number') as number[];
    }
    if (parsed?.matches && Array.isArray(parsed.matches)) {
      return parsed.matches.filter((n: unknown) => typeof n === 'number') as number[];
    }
    if (parsed?.ids && Array.isArray(parsed.ids)) {
      return parsed.ids.filter((n: unknown) => typeof n === 'number') as number[];
    }
  } catch {
    // Try to extract numbers from text
    const matches = text.match(/\b(\d+)\b/g);
    if (matches) {
      return matches.map(Number);
    }
  }
  return [];
}

export async function discoverRecipes(query: string): Promise<DiscoveredRecipe[]> {
  const allRecipes = await listRecipes();

  if (allRecipes.length === 0) {
    return [];
  }

  const recipesForAi = formatRecipesForAi(allRecipes);

  const systemPrompt =
    "Je bent een keukenassistent. Geef de beste recept-matches voor een zoekopdracht. Retourneer ALLEEN een JSON-array met de recept-ID's, gerangschikt op relevantie. Gebruik geen andere tekst.";

  const userPrompt = `Zoekopdracht: "${query}"

RECEPTEN (één per regel: id | titel | categorie | tags):
${recipesForAi}

Geef de beste matches als JSON-array: [id1, id2, id3, ...]`;

  const result = await callAiText({
    system: systemPrompt,
    user: userPrompt,
    maxTokens: 4096,
    task: 'import',
  });

  if (!result.ok) {
    throw new Error(result.message);
  }

  const matchedIds = parseDiscoverResponse(result.text);

  // Get full recipe details for matched IDs
  const matchedRecipes = allRecipes
    .filter((r) => matchedIds.includes(r.id))
    .map((r) => ({ id: r.id, title: r.title }));

  // Preserve AI ranking order
  const idToIndex = new Map(matchedIds.map((id, idx) => [id, idx]));
  return matchedRecipes.sort((a, b) => {
    const aIdx = idToIndex.get(a.id) ?? 999;
    const bIdx = idToIndex.get(b.id) ?? 999;
    return aIdx - bIdx;
  });
}
