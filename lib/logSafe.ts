/** Safe string for logs/alerts — avoids dumping arbitrary objects (React Native remote debugging). */
export function safeErrorMessage(e: unknown): string {
  if (e instanceof Error && typeof e.message === 'string' && e.message.trim())
    return e.message.trim();
  if (typeof e === 'string' && e.trim()) return e.trim();
  return 'Onbekende fout';
}
