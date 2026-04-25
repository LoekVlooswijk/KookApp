import { getAppMeta, setAppMeta } from './appMeta';
import { ensureDatabaseAsync } from './db';

const META_ACCENT = 'pref_accent_preset';
const META_BG = 'pref_background_tone';

export type AccentPresetId = 'terracotta' | 'sage' | 'ocean' | 'plum' | 'amber';

export type BackgroundToneId = 'warm' | 'cool' | 'paper';

const ACCENT_ORDER: AccentPresetId[] = ['terracotta', 'sage', 'ocean', 'plum', 'amber'];

const ACCENT_PRESETS: Record<
  AccentPresetId,
  { primary: string; soft: string; softText: string; borderMuted: string }
> = {
  terracotta: { primary: '#c05e2f', soft: '#fdf0e9', softText: '#8b4513', borderMuted: '#e8c4b0' },
  sage: { primary: '#2f6f4f', soft: '#e5f0ea', softText: '#1a4030', borderMuted: '#a8c9b6' },
  ocean: { primary: '#2a6cb6', soft: '#e8f0fa', softText: '#154070', borderMuted: '#b0c9e8' },
  plum: { primary: '#6b4c7a', soft: '#f0e8f4', softText: '#3d2a47', borderMuted: '#d0c0d8' },
  amber: { primary: '#c27f1a', soft: '#faf4e6', softText: '#6b4a12', borderMuted: '#e8d4a8' },
};

const BACKGROUND_TONES: Record<BackgroundToneId, string> = {
  warm: '#faf9f7',
  cool: '#f4f6fa',
  paper: '#f9f6ef',
};

export type AppTheme = {
  accent: string;
  accentSoft: string;
  accentSoftText: string;
  accentBorderMuted: string;
  background: string;
};

export function resolveAppTheme(accentId: AccentPresetId, bgId: BackgroundToneId): AppTheme {
  const p = ACCENT_PRESETS[accentId];
  return {
    accent: p.primary,
    accentSoft: p.soft,
    accentSoftText: p.softText,
    accentBorderMuted: p.borderMuted,
    background: BACKGROUND_TONES[bgId],
  };
}

export const ACCENT_PRESET_LABELS: Record<AccentPresetId, string> = {
  terracotta: 'Terracotta',
  sage: 'Saliegroen',
  ocean: 'Oceaanblauw',
  plum: 'Pruim',
  amber: 'Amber',
};

export const BACKGROUND_TONE_LABELS: Record<BackgroundToneId, string> = {
  warm: 'Warm grijs',
  cool: 'Koel grijs',
  paper: 'Papier',
};

export function listAccentPresetIds(): readonly AccentPresetId[] {
  return ACCENT_ORDER;
}

function parseAccent(raw: string | null): AccentPresetId {
  if (raw && raw in ACCENT_PRESETS) return raw as AccentPresetId;
  return 'terracotta';
}

function parseBackground(raw: string | null): BackgroundToneId {
  if (raw === 'cool' || raw === 'paper') return raw;
  return 'warm';
}

export async function loadAppearanceFromDb(): Promise<{
  accent: AccentPresetId;
  background: BackgroundToneId;
}> {
  await ensureDatabaseAsync();
  const a = await getAppMeta(META_ACCENT);
  const b = await getAppMeta(META_BG);
  return { accent: parseAccent(a), background: parseBackground(b) };
}

export async function persistAccentPresetId(id: AccentPresetId): Promise<void> {
  await ensureDatabaseAsync();
  await setAppMeta(META_ACCENT, id);
}

export async function persistBackgroundToneId(id: BackgroundToneId): Promise<void> {
  await ensureDatabaseAsync();
  await setAppMeta(META_BG, id);
}
