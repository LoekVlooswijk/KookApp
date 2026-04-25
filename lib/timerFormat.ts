/**
 * Dutch UI label for a step timer duration stored in seconds.
 * Examples: 30 → "30 sec", 60 → "1 min", 90 → "1 min 30 sec".
 */
export function formatStepTimerNl(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  if (s === 0) return '0 sec';
  if (s < 60) return `${s} sec`;
  const min = Math.floor(s / 60);
  const rem = s % 60;
  if (rem === 0) return `${min} min`;
  return `${min} min ${rem} sec`;
}

/**
 * Draft value for the recipe form "minutes" field (comma/dot as decimal).
 * Round-trips with `parseAmount` × 60 → seconds.
 */
export function timerSecondsToMinuteDraftStr(sec: number): string {
  if (sec <= 0) return '';
  const min = sec / 60;
  const r = Math.round(min * 1e8) / 1e8;
  return r.toFixed(8).replace(/\.?0+$/, '');
}
