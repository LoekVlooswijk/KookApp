import { ensureDatabaseAsync } from './db';
import { checkHasInternet } from './internetCheck';
import { assessProduceLocalityAndPesticides, finalizeBioScoreFromAssessment } from './bioScore';

export async function computeMissingBioScores(): Promise<{
  updated: number;
  failed: number;
}> {
  const hasInternet = await checkHasInternet();
  if (!hasInternet) {
    throw new Error('Geen internetverbinding.');
  }

  const db = await ensureDatabaseAsync();
  const recipes = await db.getAllAsync<{ id: number }>(
    `SELECT id FROM recipes WHERE bio_score_color IS NULL ORDER BY datetime(updated_at) DESC`
  );

  let updated = 0;
  let failed = 0;

  for (const r of recipes) {
    try {
      const ingRows = await db.getAllAsync<{ name: string }>(
        'SELECT name FROM ingredients WHERE recipe_id = ?',
        [r.id]
      );
      const names = ingRows.map((x) => x.name).filter(Boolean);
      const assessed = await assessProduceLocalityAndPesticides(names);
      if (!assessed.ok) {
        failed += 1;
        continue;
      }
      const { items, color } = await finalizeBioScoreFromAssessment(assessed.items);
      const now = new Date().toISOString();
      await db.runAsync(
        'UPDATE recipes SET bio_score_color = ?, bio_score_updated_at = ?, bio_score_items_json = ?, updated_at = ? WHERE id = ?',
        [color, now, JSON.stringify(items), now, r.id]
      );
      updated += 1;
    } catch {
      failed += 1;
    }
  }

  return { updated, failed };
}
