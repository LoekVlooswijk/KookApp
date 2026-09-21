import type { AiProviderId } from './aiProviders';

export type AiRequestLogEntry = {
  id: string;
  atIso: string;
  provider: AiProviderId;
  tag?: string;
  url: string;
  model?: string;
  httpStatus?: number;
  okHttp: boolean;
  stopReason?: string | null;
  usage?: { input_tokens?: number; output_tokens?: number } | null;
  /** JSON body size as sent on the wire (includes base64). */
  requestJsonChars: number;
  /** Approx size of request JSON after redacting base64 image payloads (still includes structure). */
  requestJsonCharsRedacted: number;
  imageBlocks: number;
  imageDataChars: number;
  systemChars: number;
  userTextCharsApprox: number;
  tools?: unknown;
  responseChars: number;
  errorMessage?: string;
};

const MAX = 80;
const ring: AiRequestLogEntry[] = [];

function nowId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function recordAnthropicRequestLog(entry: Omit<AiRequestLogEntry, 'id' | 'atIso'>): void {
  ring.unshift({
    id: nowId(),
    atIso: new Date().toISOString(),
    ...entry,
  });
  while (ring.length > MAX) ring.pop();
}

export function recordAiRequestLog(entry: Omit<AiRequestLogEntry, 'id' | 'atIso'>): void {
  ring.unshift({
    id: nowId(),
    atIso: new Date().toISOString(),
    ...entry,
  });
  while (ring.length > MAX) ring.pop();
}

export function listAiRequestLogs(): AiRequestLogEntry[] {
  return ring.slice();
}

export function clearAiRequestLogs(): void {
  ring.length = 0;
}

export function formatAiRequestLogEntry(e: AiRequestLogEntry): string {
  const u =
    e.usage?.input_tokens != null
      ? ` usage_in=${e.usage.input_tokens} usage_out=${e.usage?.output_tokens ?? ''}`
      : '';
  const stop = e.stopReason != null ? ` stop=${e.stopReason}` : '';
  const err = e.errorMessage ? `\nerror: ${e.errorMessage}` : '';
  return (
    `${e.atIso} ${e.tag ?? 'anthropic'}\n` +
    `model=${e.model ?? ''} http=${e.httpStatus ?? ''} okHttp=${e.okHttp}${stop}${u}\n` +
    `req_json_chars=${e.requestJsonChars} req_json_redacted_chars=${e.requestJsonCharsRedacted} ` +
    `images=${e.imageBlocks} image_data_chars=${e.imageDataChars}\n` +
    `system_chars=${e.systemChars} user_text_chars≈${e.userTextCharsApprox} resp_chars=${e.responseChars}` +
    `${err}`
  );
}
