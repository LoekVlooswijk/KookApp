import * as FileSystem from 'expo-file-system/legacy';

const COVERS_DIR = 'recipe-covers';

function extFromMime(mime: string | undefined | null): string {
  const m = (mime ?? '').toLowerCase();
  if (m.includes('png')) return 'png';
  if (m.includes('webp')) return 'webp';
  if (m.includes('heic')) return 'heic';
  return 'jpg';
}

/** Strip `data:image/...;base64,` prefix if present. */
function normalizeBase64Payload(raw: string): string {
  const t = raw.trim();
  const m = /^data:[^;]+;base64,(.*)$/is.exec(t);
  return (m?.[1] ?? t).replace(/\s/g, '');
}

function coversDirPath(): string | null {
  const root = FileSystem.documentDirectory;
  if (!root) return null;
  return `${root}${COVERS_DIR}`;
}

/** True for files we store under documentDirectory/recipe-covers (safe to delete on replace/remove). */
export function isAppManagedCoverUri(uri: string | null | undefined): boolean {
  if (!uri) return false;
  return uri.includes(`/${COVERS_DIR}/`);
}

export async function ensureRecipeCoversDirectory(): Promise<string | null> {
  const dir = coversDirPath();
  if (!dir) return null;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  return dir;
}

function extensionFromUri(uri: string): string {
  const lower = uri.split('?')[0]?.toLowerCase() ?? '';
  if (lower.endsWith('.png')) return 'png';
  if (lower.endsWith('.webp')) return 'webp';
  if (lower.endsWith('.heic')) return 'heic';
  return 'jpg';
}

/**
 * Copies a picked image into app document storage so it keeps working after the picker temp URI expires.
 * On web (no documentDirectory), returns the source URI unchanged.
 */
export async function persistPickedRecipeCover(sourceUri: string): Promise<string> {
  const dir = await ensureRecipeCoversDirectory();
  if (!dir) return sourceUri;
  const ext = extensionFromUri(sourceUri);
  const dest = `${dir}/cover-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  await FileSystem.copyAsync({ from: sourceUri, to: dest });
  return dest;
}

/**
 * Schrijf een galerij-screenshot naar `recipe-covers` vanuit base64 (fallback als `copyAsync` vanaf `content://` faalt).
 */
export async function persistRecipeCoverFromBase64(
  base64: string,
  mimeType?: string | null
): Promise<string | null> {
  const dir = await ensureRecipeCoversDirectory();
  if (!dir) return null;
  const normalized = normalizeBase64Payload(base64);
  if (!normalized) return null;
  const ext = extFromMime(mimeType);
  const dest = `${dir}/cover-b64-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  try {
    await FileSystem.writeAsStringAsync(dest, normalized, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const info = await FileSystem.getInfoAsync(dest);
    if (!info.exists || info.isDirectory) return null;
    return dest;
  } catch {
    try {
      await FileSystem.deleteAsync(dest, { idempotent: true });
    } catch {
      /* */
    }
    return null;
  }
}

const DOWNLOAD_HEADERS: Record<string, string> = {
  Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
  'Accept-Language': 'nl,en;q=0.9',
  'User-Agent':
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
};

/**
 * Download een recept-hero van een https-URL naar `recipe-covers` (zelfde plek als galerij-covers).
 * Retourneert null bij falen of op web zonder documentDirectory.
 * `refererPageUrl`: receptpagina-URL; veel CDN’s weigeren zonder Referer.
 */
export async function downloadRecipeCoverFromUrl(
  remoteUrl: string,
  options?: { refererPageUrl?: string | null }
): Promise<string | null> {
  const trimmed = remoteUrl.trim();
  if (!trimmed.startsWith('http')) return null;
  const dir = await ensureRecipeCoversDirectory();
  if (!dir) return null;
  const ext = extensionFromUri(trimmed.split('?')[0] ?? trimmed);
  const dest = `${dir}/cover-dl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const headers: Record<string, string> = { ...DOWNLOAD_HEADERS };
  const ref = options?.refererPageUrl?.trim();
  if (ref && ref.startsWith('http')) {
    headers.Referer = ref;
  }
  try {
    const result = await FileSystem.downloadAsync(trimmed, dest, { headers });
    if (result.status !== 200) return null;
    const info = await FileSystem.getInfoAsync(dest);
    if (!info.exists || info.isDirectory) return null;
    return dest;
  } catch {
    try {
      await FileSystem.deleteAsync(dest, { idempotent: true });
    } catch {
      /* */
    }
    return null;
  }
}

export async function tryDeleteManagedCover(uri: string | null | undefined): Promise<void> {
  if (!uri || !isAppManagedCoverUri(uri)) return;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const info = await FileSystem.getInfoAsync(uri);
      if (!info.exists) return;
      await FileSystem.deleteAsync(uri, { idempotent: true });
      return;
    } catch {
      if (attempt === 2) return;
      await new Promise<void>((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
}
