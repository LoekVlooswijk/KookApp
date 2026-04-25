import { ensureDatabaseAsync } from './db';

export type WeekPlanRow = {
  id: number;
  date: string; // YYYY-MM-DD
  recipeId: number;
  servings: number;
  cooksForDays: number;
  /** Als gezet: deze dag is een restjes-dag van de opgegeven kookdag (YYYY-MM-DD). */
  leftoverOfDate: string | null;
  sortOrder: number | null;
};

function clampInt(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

export function toIsoDateOnly(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Display helper: `YYYY-MM-DD` → `DD-MM-YYYY` (Dutch-friendly). */
export function formatDateDdMmYyyy(dateOnlyIso: string): string {
  const t = (dateOnlyIso ?? '').trim();
  const [y, m, d] = t.split('-');
  if (!y || !m || !d) return t;
  if (y.length !== 4 || m.length !== 2 || d.length !== 2) return t;
  return `${d}-${m}-${y}`;
}

export function addDays(dateOnly: string, days: number): string {
  const [y, m, d] = dateOnly.split('-').map((x) => Number.parseInt(x, 10));
  const base = new Date(y, (m ?? 1) - 1, d ?? 1);
  base.setDate(base.getDate() + days);
  return toIsoDateOnly(base);
}

export async function listWeekPlansBetween(startDate: string, endDate: string): Promise<WeekPlanRow[]> {
  const db = await ensureDatabaseAsync();
  const rows = await db.getAllAsync<{
    id: number;
    date: string;
    recipe_id: number;
    servings: number;
    cooks_for_days: number;
    leftover_of_date: string | null;
    sort_order: number | null;
  }>(
    `SELECT id, date, recipe_id, servings, cooks_for_days, leftover_of_date, sort_order
     FROM week_plans
     WHERE date >= ? AND date <= ?
     ORDER BY date ASC, COALESCE(sort_order, 0) ASC, id ASC`,
    [startDate, endDate]
  );
  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    recipeId: r.recipe_id,
    servings: r.servings,
    cooksForDays: r.cooks_for_days,
    leftoverOfDate: r.leftover_of_date,
    sortOrder: r.sort_order,
  }));
}

export async function upsertWeekPlan(params: {
  date: string;
  recipeId: number;
  servings: number;
  cooksForDays: number;
  leftoverOfDate?: string | null;
}): Promise<number> {
  const db = await ensureDatabaseAsync();
  const date = params.date.trim();
  const recipeId = clampInt(params.recipeId, 1, 1_000_000_000);
  const servings = clampInt(params.servings, 1, 99);
  const cooksForDays = clampInt(params.cooksForDays, 1, 7);
  const leftoverOfDate = (params.leftoverOfDate ?? null)?.trim() || null;

  // "Upsert" by date: for now one dinner per day (simple and predictable).
  const existing = await db.getFirstAsync<{ id: number }>('SELECT id FROM week_plans WHERE date = ? LIMIT 1', [
    date,
  ]);
  if (existing?.id) {
    await db.runAsync(
      'UPDATE week_plans SET recipe_id = ?, servings = ?, cooks_for_days = ?, leftover_of_date = ? WHERE id = ?',
      [recipeId, servings, cooksForDays, leftoverOfDate, existing.id]
    );
    return existing.id;
  }

  const r = await db.runAsync(
    'INSERT INTO week_plans (date, recipe_id, servings, cooks_for_days, leftover_of_date, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
    [date, recipeId, servings, cooksForDays, leftoverOfDate, null]
  );
  return Number(r.lastInsertRowId);
}

export async function deleteWeekPlanByDate(date: string): Promise<void> {
  const db = await ensureDatabaseAsync();
  await db.runAsync('DELETE FROM week_plans WHERE date = ?', [date.trim()]);
}

export async function deleteWeekPlansBetween(startDate: string, endDate: string): Promise<void> {
  const db = await ensureDatabaseAsync();
  await db.runAsync('DELETE FROM week_plans WHERE date >= ? AND date <= ?', [startDate.trim(), endDate.trim()]);
}

