import { z } from 'zod';

export const VERSION = '0.1.0';
export const WIRE_VERSION = 1;
export const DEFAULT_PORT = 32145;
export const methods = ['get_status', 'list_tabs', 'start_session', 'end_session', 'observe', 'act', 'upload_file', 'get_downloads'] as const;
export type Method = typeof methods[number];
const point = z.object({ x: z.number().finite().nonnegative(), y: z.number().finite().nonnegative() }).strict();
const modifiers = z.array(z.enum(['Alt', 'Control', 'Meta', 'Shift'])).max(4).optional();
export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.enum(['click', 'double_click', 'right_click']), ...point.shape, modifiers }).strict(),
  z.object({ type: z.literal('drag'), from: point, to: point, modifiers }).strict(),
  z.object({ type: z.literal('scroll'), ...point.shape, deltaX: z.number().finite().min(-4000).max(4000).default(0), deltaY: z.number().finite().min(-4000).max(4000) }).strict(),
  z.object({ type: z.literal('type_text'), text: z.string().min(1).max(20000) }).strict(),
  z.object({ type: z.literal('press_key'), key: z.string().min(1).max(40), modifiers }).strict(),
]);
export type Action = z.infer<typeof actionSchema>;
export const sessionSchema = z.object({ sessionId: z.string().uuid() }).strict();
export const toolSchemas = {
  get_status: z.object({}).strict(),
  list_tabs: z.object({}).strict(),
  start_session: z.object({ tabId: z.number().int().nonnegative() }).strict(),
  end_session: sessionSchema,
  observe: sessionSchema,
  act: sessionSchema.extend({ snapshotId: z.string().uuid(), action: actionSchema }).strict(),
  upload_file: sessionSchema.extend({ path: z.string().min(1), chooserId: z.string().uuid() }).strict(),
  get_downloads: sessionSchema,
};
export type Params = Record<string, unknown>;
export interface WireRequest { type: 'request'; id: string; method: Method; params: Params }
export interface WireResponse { type: 'response'; id: string; result?: unknown; error?: { code: string; message: string } }
export interface Observation {
  sessionId: string;
  snapshotId: string;
  tabId: number;
  url: string;
  viewport: { width: number; height: number; deviceScaleFactor: number };
  screenshot: { data: string; mimeType: 'image/png'; width: number; height: number; cssToImageX: number; cssToImageY: number };
  elements: { role: string; name: string; value?: string; bounds?: { x: number; y: number; width: number; height: number } }[];
  warnings: string[];
  pendingUpload?: { chooserId: string; multiple: boolean };
}
export class AgentError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'AgentError'; }
}
export function errorInfo(error: unknown): { code: string; message: string } {
  return error instanceof AgentError ? { code: error.code, message: error.message } : { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : 'Unknown error' };
}
export function presentationId(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'docs.google.com' || parsed.port) return;
    return /^\/presentation\/(?:u\/\d+\/)?d\/([\w-]+)(?:\/|$)/.exec(parsed.pathname)?.[1];
  } catch { return; }
}
export function matchesDownload(item: { url?: string; finalUrl?: string; referrer?: string; startTime: string }, id: string, since: number): boolean {
  if (Date.parse(item.startTime) < since) return false;
  return [item.url, item.finalUrl, item.referrer].some(url => url && presentationId(url) === id);
}
export function assertPoint(x: number, y: number, width: number, height: number): void {
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= width || y >= height) {
    throw new AgentError('OUT_OF_BOUNDS', 'Coordinates must be inside the CSS viewport from observe.');
  }
}
export function modifierMask(modifiers: string[] = []): number {
  return modifiers.reduce((mask, key) => mask | ({ Alt: 1, Control: 2, Meta: 4, Shift: 8 }[key] ?? 0), 0);
}
export function keyDefinition(key: string): { key: string; code: string; windowsVirtualKeyCode: number } {
  const named: Record<string, [string, number]> = {
    Enter: ['Enter', 13], Tab: ['Tab', 9], Escape: ['Escape', 27], Backspace: ['Backspace', 8], Delete: ['Delete', 46],
    ArrowLeft: ['ArrowLeft', 37], ArrowUp: ['ArrowUp', 38], ArrowRight: ['ArrowRight', 39], ArrowDown: ['ArrowDown', 40],
    Home: ['Home', 36], End: ['End', 35], PageUp: ['PageUp', 33], PageDown: ['PageDown', 34],
    Space: ['Space', 32], F5: ['F5', 116], F11: ['F11', 122], F12: ['F12', 123],
  };
  if (named[key]) return { key: key === 'Space' ? ' ' : key, code: named[key][0], windowsVirtualKeyCode: named[key][1] };
  if (/^[a-z]$/i.test(key)) return { key, code: `Key${key.toUpperCase()}`, windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0) };
  if (/^[0-9]$/.test(key)) return { key, code: `Digit${key}`, windowsVirtualKeyCode: key.charCodeAt(0) };
  throw new AgentError('UNSUPPORTED_KEY', 'Use a letter, digit, or supported named key. Use type_text for text and Unicode.');
}
