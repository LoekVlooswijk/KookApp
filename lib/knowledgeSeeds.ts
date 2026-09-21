import { ensureDatabaseAsync } from './db';
import { upsertKnowledgeTagByName } from './knowledgeRepo';

const TECHNIQUES = [
  {
    title: 'Aanbraden',
    content:
      'Hete pan, droog vlees, weinig olie. Niet bewegen tot de korst loslaat — dan pas omdraaien. Maillard-reactie geeft smaak.',
  },
  {
    title: 'Blancheren',
    content:
      'Kort koken in zout water, dan direct in ijswater. Behoudt kleur en beet van groene groenten. 30s–2min afhankelijk van groente.',
  },
  {
    title: 'Deglaceren',
    content:
      'Na aanbraden: pan van vuur, scheut wijn/bouillon erbij, aanbaksels losschrapen. Basis voor jus en saus.',
  },
  {
    title: 'Emulgeren',
    content:
      'Twee niet-mengende vloeistoffen verbinden via een emulgator (mosterd, eigeel, lecithine). Langzaam toevoegen, blijven kloppen.',
  },
  {
    title: 'Julienne',
    content:
      'Lange dunne reepjes (~3mm × 5cm). Eerst plat snijden, op elkaar leggen, in reepjes. Voor wokken en garnituur.',
  },
] as const;

export async function seedTechniquesIfEmpty(): Promise<void> {
  const db = await ensureDatabaseAsync();
  const exists = await db.getFirstAsync<{ c: number }>(
    `SELECT COUNT(*) as c
     FROM knowledge_entries e
     JOIN knowledge_entry_tags et ON et.entry_id = e.id
     JOIN knowledge_tags t ON t.id = et.tag_id
     WHERE t.name = 'Technieken'`
  );
  if ((exists?.c ?? 0) > 0) return;

  const tag = await upsertKnowledgeTagByName('Technieken');
  if (!tag) return;

  const now = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    for (const e of TECHNIQUES) {
      const res = await db.runAsync(
        `INSERT INTO knowledge_entries
         (title, content, ratio, source_recipe_id, is_pinned, pinned_at, created_at, updated_at)
         VALUES (?, ?, NULL, NULL, 0, NULL, ?, ?)`,
        [e.title, e.content, now, now]
      );
      const id = Number(res.lastInsertRowId);
      await db.runAsync(
        'INSERT OR IGNORE INTO knowledge_entry_tags (entry_id, tag_id) VALUES (?, ?)',
        [id, tag.id]
      );
    }
  });
}
