/**
 * Best-effort connectivity check.
 * We avoid new deps (e.g. expo-network) and instead do a quick fetch with a timeout.
 */
export async function checkHasInternet(timeoutMs: number = 2500): Promise<boolean> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), Math.max(500, timeoutMs));
  try {
    // 204 endpoint commonly used for connectivity checks.
    const res = await fetch('https://clients3.google.com/generate_204', {
      method: 'GET',
      signal: controller.signal,
    });
    return !!res && (res.status === 204 || (res.status >= 200 && res.status < 400));
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}
