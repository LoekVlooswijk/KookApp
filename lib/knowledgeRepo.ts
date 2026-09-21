import { ensureDatabaseAsync } from './db';

export type KnowledgeTagRow = {
  id: number;
  name: string;
  isSheet: boolean;
  sortOrder: number | null;
  icon: string | null;
  accent: string | null;
  isWide: boolean;
  entryCount: number;
};

export type KnowledgeEntryRow = {
  id: number;
  title: string;
  content: string | null;
  ratio: string | null;
  sourceRecipeId: number | null;
  isPinned: boolean;
  pinnedAt: string | null;
  createdAt: string;
  updatedAt: string;
  tagNames: string[];
};

export type KnowledgeTagBare = {
  id: number;
  name: string;
  isSheet: boolean;
  sortOrder: number | null;
  icon: string | null;
  accent: string | null;
  isWide: boolean;
};

export type KnowledgeEntryDetail = KnowledgeEntryRow & {
  tagIds: number[];
  sourceRecipeTitle: string | null;
};

function splitTagNames(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split('|')
    .map((x) => x.trim())
    .filter(Boolean);
}

export async function listKnowledgeSheets(): Promise<KnowledgeTagRow[]> {
  const db = await ensureDatabaseAsync();
  const rows = await db.getAllAsync<{
    id: number;
    name: string;
    is_pinned: number;
    sort_order: number | null;
    icon: string | null;
    accent: string | null;
    is_wide?: number;
    entry_count: number;
  }>(
    `
    SELECT
      t.id,
      t.name,
      t.is_pinned,
      t.sort_order,
      t.icon,
      t.accent,
      t.is_wide,
      COUNT(et.entry_id) AS entry_count
    FROM knowledge_tags t
    LEFT JOIN knowledge_entry_tags et ON et.tag_id = t.id
    WHERE t.is_pinned = 1
    GROUP BY t.id
    ORDER BY COALESCE(t.sort_order, 9999) ASC, LOWER(t.name) ASC
    `
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    isSheet: r.is_pinned === 1,
    sortOrder: r.sort_order,
    icon: r.icon,
    accent: r.accent,
    isWide: (r.is_wide ?? 0) === 1,
    entryCount: r.entry_count ?? 0,
  }));
}

export async function listKnowledgeTags(): Promise<KnowledgeTagBare[]> {
  const db = await ensureDatabaseAsync();
  const rows = await db.getAllAsync<{
    id: number;
    name: string;
    is_pinned: number;
    sort_order: number | null;
    icon: string | null;
    accent: string | null;
    is_wide?: number;
  }>(
    `
    SELECT id, name, is_pinned, sort_order, icon, accent, is_wide
    FROM knowledge_tags
    ORDER BY is_pinned DESC, COALESCE(sort_order, 9999) ASC, LOWER(name) ASC
    `
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    isSheet: r.is_pinned === 1,
    sortOrder: r.sort_order,
    icon: r.icon,
    accent: r.accent,
    isWide: (r.is_wide ?? 0) === 1,
  }));
}

export async function getKnowledgeTag(tagId: number): Promise<KnowledgeTagBare | null> {
  const db = await ensureDatabaseAsync();
  const r = await db.getFirstAsync<{
    id: number;
    name: string;
    is_pinned: number;
    sort_order: number | null;
    icon: string | null;
    accent: string | null;
    is_wide?: number;
  }>(
    `SELECT id, name, is_pinned, sort_order, icon, accent, is_wide
     FROM knowledge_tags
     WHERE id = ?`,
    [tagId]
  );
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    isSheet: r.is_pinned === 1,
    sortOrder: r.sort_order,
    icon: r.icon,
    accent: r.accent,
    isWide: (r.is_wide ?? 0) === 1,
  };
}

export async function listLooseKnowledgeNotes(): Promise<KnowledgeEntryRow[]> {
  const db = await ensureDatabaseAsync();
  const rows = await db.getAllAsync<{
    id: number;
    title: string;
    content: string | null;
    ratio: string | null;
    source_recipe_id: number | null;
    is_pinned: number;
    pinned_at: string | null;
    created_at: string;
    updated_at: string;
    tag_names: string | null;
  }>(
    `
    SELECT
      e.id,
      e.title,
      e.content,
      e.ratio,
      e.source_recipe_id,
      e.is_pinned,
      e.pinned_at,
      e.created_at,
      e.updated_at,
      GROUP_CONCAT(t.name, '|') AS tag_names
    FROM knowledge_entries e
    LEFT JOIN knowledge_entry_tags et ON et.entry_id = e.id
    LEFT JOIN knowledge_tags t ON t.id = et.tag_id
    WHERE e.id NOT IN (SELECT DISTINCT entry_id FROM knowledge_entry_tags)
    GROUP BY e.id
    ORDER BY e.is_pinned DESC, e.pinned_at DESC, e.updated_at DESC, e.id DESC
    `
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    content: r.content,
    ratio: r.ratio,
    sourceRecipeId: r.source_recipe_id,
    isPinned: r.is_pinned === 1,
    pinnedAt: r.pinned_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    tagNames: splitTagNames(r.tag_names),
  }));
}

export async function listKnowledgeEntriesForTag(tagId: number): Promise<KnowledgeEntryRow[]> {
  const db = await ensureDatabaseAsync();
  const rows = await db.getAllAsync<{
    id: number;
    title: string;
    content: string | null;
    ratio: string | null;
    source_recipe_id: number | null;
    is_pinned: number;
    pinned_at: string | null;
    created_at: string;
    updated_at: string;
    tag_names: string | null;
  }>(
    `
    SELECT
      e.id,
      e.title,
      e.content,
      e.ratio,
      e.source_recipe_id,
      e.is_pinned,
      e.pinned_at,
      e.created_at,
      e.updated_at,
      GROUP_CONCAT(t2.name, '|') AS tag_names
    FROM knowledge_entries e
    JOIN knowledge_entry_tags et ON et.entry_id = e.id AND et.tag_id = ?
    LEFT JOIN knowledge_entry_tags et2 ON et2.entry_id = e.id
    LEFT JOIN knowledge_tags t2 ON t2.id = et2.tag_id
    GROUP BY e.id
    ORDER BY e.is_pinned DESC, e.pinned_at DESC, e.updated_at DESC, e.id DESC
    `,
    [tagId]
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    content: r.content,
    ratio: r.ratio,
    sourceRecipeId: r.source_recipe_id,
    isPinned: r.is_pinned === 1,
    pinnedAt: r.pinned_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    tagNames: splitTagNames(r.tag_names),
  }));
}

export async function toggleKnowledgeEntryPinned(entryId: number): Promise<void> {
  const db = await ensureDatabaseAsync();
  const row = await db.getFirstAsync<{ is_pinned: number }>(
    'SELECT is_pinned FROM knowledge_entries WHERE id = ?',
    [entryId]
  );
  if (!row) return;
  const now = new Date().toISOString();
  const nextPinned = row.is_pinned === 1 ? 0 : 1;
  await db.runAsync(
    `UPDATE knowledge_entries
     SET is_pinned = ?, pinned_at = ?, updated_at = ?
     WHERE id = ?`,
    [nextPinned, nextPinned === 1 ? now : null, now, entryId]
  );
}

export async function getKnowledgeEntry(entryId: number): Promise<KnowledgeEntryDetail | null> {
  const db = await ensureDatabaseAsync();
  const row = await db.getFirstAsync<{
    id: number;
    title: string;
    content: string | null;
    ratio: string | null;
    source_recipe_id: number | null;
    is_pinned: number;
    pinned_at: string | null;
    created_at: string;
    updated_at: string;
    tag_names: string | null;
    tag_ids: string | null;
    recipe_title: string | null;
  }>(
    `
    SELECT
      e.id,
      e.title,
      e.content,
      e.ratio,
      e.source_recipe_id,
      e.is_pinned,
      e.pinned_at,
      e.created_at,
      e.updated_at,
      GROUP_CONCAT(t.name, '|') AS tag_names,
      GROUP_CONCAT(t.id, '|') AS tag_ids,
      r.title AS recipe_title
    FROM knowledge_entries e
    LEFT JOIN knowledge_entry_tags et ON et.entry_id = e.id
    LEFT JOIN knowledge_tags t ON t.id = et.tag_id
    LEFT JOIN recipes r ON r.id = e.source_recipe_id
    WHERE e.id = ?
    GROUP BY e.id
    `,
    [entryId]
  );
  if (!row) return null;
  const tagIds = (row.tag_ids ?? '')
    .split('|')
    .map((x) => Number.parseInt(x, 10))
    .filter((n) => Number.isFinite(n));
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    ratio: row.ratio,
    sourceRecipeId: row.source_recipe_id,
    sourceRecipeTitle: row.recipe_title,
    isPinned: row.is_pinned === 1,
    pinnedAt: row.pinned_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    tagNames: splitTagNames(row.tag_names),
    tagIds,
  };
}

export async function upsertKnowledgeTagByName(nameRaw: string): Promise<KnowledgeTagBare | null> {
  const name = nameRaw.trim();
  if (!name) return null;
  const db = await ensureDatabaseAsync();
  await db.runAsync('INSERT OR IGNORE INTO knowledge_tags (name, is_pinned) VALUES (?, 0)', [name]);
  const row = await db.getFirstAsync<{
    id: number;
    name: string;
    is_pinned: number;
    sort_order: number | null;
    icon: string | null;
    accent: string | null;
    is_wide?: number;
  }>(
    'SELECT id, name, is_pinned, sort_order, icon, accent, is_wide FROM knowledge_tags WHERE name = ?',
    [name]
  );
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    isSheet: row.is_pinned === 1,
    sortOrder: row.sort_order,
    icon: row.icon,
    accent: row.accent,
    isWide: (row.is_wide ?? 0) === 1,
  };
}

export async function saveKnowledgeEntry(params: {
  id?: number;
  title: string;
  content: string | null;
  ratio: string | null;
  sourceRecipeId: number | null;
  tagIds: number[];
}): Promise<number> {
  const title = params.title.trim();
  if (!title) throw new Error('Titel is verplicht.');
  const db = await ensureDatabaseAsync();
  const now = new Date().toISOString();
  const content = params.content?.trim() ? params.content.trim() : null;
  const ratio = params.ratio?.trim() ? params.ratio.trim() : null;
  const sourceRecipeId = params.sourceRecipeId ?? null;

  let entryId = 0;
  await db.withTransactionAsync(async () => {
    let id = params.id ?? null;
    if (id == null) {
      const res = await db.runAsync(
        `INSERT INTO knowledge_entries
         (title, content, ratio, source_recipe_id, is_pinned, pinned_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, NULL, ?, ?)`,
        [title, content, ratio, sourceRecipeId, now, now]
      );
      id = Number(res.lastInsertRowId);
    } else {
      await db.runAsync(
        `UPDATE knowledge_entries
         SET title = ?, content = ?, ratio = ?, source_recipe_id = ?, updated_at = ?
         WHERE id = ?`,
        [title, content, ratio, sourceRecipeId, now, id]
      );
    }

    await db.runAsync('DELETE FROM knowledge_entry_tags WHERE entry_id = ?', [id]);
    const uniq = Array.from(new Set(params.tagIds.filter((n) => Number.isFinite(n))));
    for (const tagId of uniq) {
      await db.runAsync(
        'INSERT OR IGNORE INTO knowledge_entry_tags (entry_id, tag_id) VALUES (?, ?)',
        [id, tagId]
      );
    }
    entryId = id as number;
  });
  return entryId;
}

export async function deleteKnowledgeEntry(entryId: number): Promise<void> {
  const db = await ensureDatabaseAsync();
  await db.runAsync('DELETE FROM knowledge_entries WHERE id = ?', [entryId]);
}

export async function searchKnowledgeEntries(query: string): Promise<KnowledgeEntryRow[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const db = await ensureDatabaseAsync();
  const like = `%${q}%`;
  const rows = await db.getAllAsync<{
    id: number;
    title: string;
    content: string | null;
    ratio: string | null;
    source_recipe_id: number | null;
    is_pinned: number;
    pinned_at: string | null;
    created_at: string;
    updated_at: string;
    tag_names: string | null;
  }>(
    `
    SELECT
      e.id,
      e.title,
      e.content,
      e.ratio,
      e.source_recipe_id,
      e.is_pinned,
      e.pinned_at,
      e.created_at,
      e.updated_at,
      GROUP_CONCAT(t.name, '|') AS tag_names
    FROM knowledge_entries e
    LEFT JOIN knowledge_entry_tags et ON et.entry_id = e.id
    LEFT JOIN knowledge_tags t ON t.id = et.tag_id
    GROUP BY e.id
    HAVING LOWER(
      e.title || ' ' ||
      IFNULL(e.content, '') || ' ' ||
      IFNULL(e.ratio, '') || ' ' ||
      IFNULL(GROUP_CONCAT(t.name, ' '), '')
    ) LIKE ?
    ORDER BY e.updated_at DESC, e.id DESC
    `,
    [like]
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    content: r.content,
    ratio: r.ratio,
    sourceRecipeId: r.source_recipe_id,
    isPinned: r.is_pinned === 1,
    pinnedAt: r.pinned_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    tagNames: splitTagNames(r.tag_names),
  }));
}
