import { ensureDatabaseAsync } from './db';
import { upsertKnowledgeTagByName } from './knowledgeRepo';

type KnowledgeSeed = {
  title: string;
  content: string;
  ratio?: string;
};

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

const COOKING_TIMES: KnowledgeSeed[] = [
  {
    title: 'Aardappelen (geheel)',
    content:
      'Koken in gezouten water: 20–25 min vanaf het moment dat het water kookt. Gaar als een mes er zo in glijdt.',
    ratio: '20–25 min',
  },
  {
    title: 'Broccoli',
    content:
      'Koken: 4–6 min (net knapperig). Stomen: 6–8 min. Roerbakken: 3–4 min in kleine roosjes.',
    ratio: '4–8 min',
  },
  {
    title: 'Eieren (zacht / hard)',
    content:
      'Zacht: 6–7 min. Half-zacht: 8–9 min. Hard: 10–12 min. Direct schrikken in koud water om makkelijk te pellen.',
    ratio: '6–12 min',
  },
  {
    title: 'Pasta (al dente)',
    content:
      'Meeste soorten 8–11 min, check de verpakking. Al dente = 1–2 min korter dan de aangegeven tijd. Giet af, niet afspoelen behalve voor koude salades.',
    ratio: '8–11 min',
  },
  {
    title: 'Witte rijst',
    content:
      '12–15 min (of 10–12 min bij rijstverhouding 1:1,5, laag vuur, deksel erop). Daarna 5 min laten stomen met het vuur uit.',
    ratio: '12–15 min',
  },
  {
    title: 'Quinoa',
    content:
      'Koken 12–15 min in twee delen water per deel quinoa. Water helemaal opgenomen = gaar. Even laten rusten en losroeren met een vork.',
    ratio: '12–15 min',
  },
  {
    title: 'Wortelen',
    content:
      'Koken in plakjes: 6–8 min. Heel: 10–12 min. Stomen: 8–10 min. Glaceren in boter: 10–12 min laag vuur.',
    ratio: '6–12 min',
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

export async function seedCookingTimesIfEmpty(): Promise<void> {
  const db = await ensureDatabaseAsync();
  const exists = await db.getFirstAsync<{ c: number }>(
    `SELECT COUNT(*) as c
     FROM knowledge_entries e
     JOIN knowledge_entry_tags et ON et.entry_id = e.id
     JOIN knowledge_tags t ON t.id = et.tag_id
     WHERE t.name = 'Kooktijden'`
  );
  if ((exists?.c ?? 0) > 0) return;

  const tag = await upsertKnowledgeTagByName('Kooktijden');
  if (!tag) return;

  const now = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    for (const e of COOKING_TIMES) {
      const res = await db.runAsync(
        `INSERT INTO knowledge_entries
         (title, content, ratio, source_recipe_id, is_pinned, pinned_at, created_at, updated_at)
         VALUES (?, ?, ?, NULL, 0, NULL, ?, ?)`,
        [e.title, e.content, e.ratio ?? null, now, now]
      );
      const id = Number(res.lastInsertRowId);
      await db.runAsync(
        'INSERT OR IGNORE INTO knowledge_entry_tags (entry_id, tag_id) VALUES (?, ?)',
        [id, tag.id]
      );
    }
  });
}
