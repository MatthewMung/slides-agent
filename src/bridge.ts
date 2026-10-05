import { createServer } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { z } from 'zod';
import type { Config } from './config.js';
import { validateImage, verifyDownloads } from './files.js';
import { AgentError, errorInfo, methods, toolSchemas, VERSION, WIRE_VERSION, type Method, type Params, type WireResponse } from './protocol.js';

const helloSchema = z.object({ type: z.literal('hello'), version: z.literal(WIRE_VERSION), role: z.enum(['extension', 'mcp']), token: z.string().max(128) }).strict();
const requestSchema = z.object({ type: z.literal('request'), id: z.string().uuid(), method: z.enum(methods), params: z.record(z.string(), z.unknown()) }).strict();
type Pending = { resolve: (result: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };
export async function createBridge(config: Config, options: { requestTimeout?: number } = {}) {
  const http = createServer((_request, response) => { response.writeHead(404); response.end(); });
  const server = new WebSocketServer({ server: http, maxPayload: 16 * 1024 * 1024, perMessageDeflate: false });
  const pending = new Map<string, Pending>();
  let extension: WebSocket | undefined;
  let owner: WebSocket | undefined;
  let activeSession: string | undefined;
  let busy = false;
  const send = (socket: WebSocket, message: unknown) => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); };
  function stop(reason: string) {
    owner = undefined; activeSession = undefined;
    if (extension) send(extension, { type: 'stop', reason });
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new AgentError('SESSION_STOPPED', reason)); }
    pending.clear();
  }
  function forward(method: Method, params: Params): Promise<any> {
    if (!extension || extension.readyState !== WebSocket.OPEN) return Promise.reject(new AgentError('EXTENSION_OFFLINE', 'Connect the Chrome extension to the bridge.'));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new AgentError('OPERATION_TIMEOUT', 'Result is unknown. Session stopped; inspect before retrying.'));
        stop('Operation timed out; no automatic replay.');
      }, options.requestTimeout ?? 30000);
      pending.set(id, { resolve, reject, timer });
      send(extension!, { type: 'request', id, method, params });
    });
  }
  async function dispatch(client: WebSocket, method: Method, params: Params): Promise<any> {
    params = toolSchemas[method].parse(params) as Params;
    if (method === 'get_status') {
      let browser: any;
      if (extension) browser = await forward('get_status', {});
      return { version: VERSION, bridge: 'connected', extension: !!extension, controlling: !!owner, ownedByThisClient: owner === client, browser };
    }
    if (method === 'list_tabs') return forward(method, params);
    if (busy) throw new AgentError('BUSY', 'Wait for the current operation to finish.');
    if (method === 'start_session') {
      if (owner) throw new AgentError('SESSION_IN_USE', 'Another session controls a presentation. End it first.');
      owner = client;
    } else if (owner !== client || !activeSession || params.sessionId !== activeSession) {
      throw new AgentError('SESSION_NOT_OWNED', 'This client does not own that session. Start a session first.');
    }
    busy = true;
    try {
      if (method === 'upload_file') params = { ...params, path: await validateImage(params.path as string) };
      const result = await forward(method, params);
      if (method === 'start_session') {
        if (owner !== client || client.readyState !== WebSocket.OPEN) throw new AgentError('SESSION_STOPPED', 'Client disconnected during session start.');
        activeSession = z.string().uuid().parse(result.sessionId);
      }
      if (method === 'end_session') { owner = undefined; activeSession = undefined; }
      return method === 'get_downloads' ? await verifyDownloads(result) : result;
    } catch (error) {
      if (method === 'start_session' || method === 'end_session') stop('Session operation failed.');
      throw error;
    } finally { busy = false; }
  }
  server.on('connection', (socket, request) => {
    let role: 'extension' | 'mcp' | undefined;
    const timer = setTimeout(() => socket.close(1008, 'Authentication required'), 5000);
    socket.on('error', () => {});
    socket.on('message', async raw => {
      let data: any;
      try { data = JSON.parse(raw.toString()); } catch { socket.close(1008, 'Invalid JSON'); return; }
      if (!role) {
        const hello = helloSchema.safeParse(data);
        if (!hello.success) { socket.close(1008, 'Invalid handshake'); return; }
        const incoming = Buffer.from(hello.data.token);
        const expected = Buffer.from(config.token);
        const origin = request.headers.origin;
        const originOK = hello.data.role === 'extension' ? !!origin && /^chrome-extension:\/\/[a-p]{32}$/.test(origin) : !origin;
        if (!originOK || incoming.length !== expected.length || !timingSafeEqual(incoming, expected)) { socket.close(1008, 'Authentication failed'); return; }
        if (hello.data.role === 'extension' && extension) { socket.close(1008, 'An extension is already connected'); return; }
        role = hello.data.role;
        clearTimeout(timer);
        if (role === 'extension') extension = socket;
        send(socket, { type: 'ready', version: WIRE_VERSION });
        return;
      }
      if (data.type === 'heartbeat') return;
      if (role === 'extension') {
        if (data.type === 'stopped') { stop('Chrome control was stopped.'); return; }
        if (data.type !== 'response' || typeof data.id !== 'string') { socket.close(1008, 'Invalid response'); return; }
        const item = pending.get(data.id);
        if (!item) return;
        clearTimeout(item.timer); pending.delete(data.id);
        if (data.error) item.reject(new AgentError(String(data.error.code), String(data.error.message)));
        else item.resolve(data.result);
        return;
      }
      const parsed = requestSchema.safeParse(data);
      if (!parsed.success) { socket.close(1008, 'Invalid request'); return; }
      const response: WireResponse = { type: 'response', id: parsed.data.id };
      try { response.result = await dispatch(socket, parsed.data.method, parsed.data.params); }
      catch (error) { response.error = error instanceof z.ZodError ? { code: 'INVALID_PARAMS', message: 'Request parameters do not match the tool schema.' } : errorInfo(error); }
      send(socket, response);
    });
    socket.on('close', () => {
      clearTimeout(timer);
      if (socket === extension) { extension = undefined; stop('Chrome extension disconnected.'); }
      if (socket === owner) stop('MCP client disconnected.');
    });
  });
  const heartbeat = setInterval(() => { for (const socket of server.clients) send(socket, { type: 'heartbeat' }); }, 20000);
  heartbeat.unref();
  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(config.port, '127.0.0.1', () => resolve());
  }).catch(error => { clearInterval(heartbeat); server.close(); throw error; });
  return {
    port: (http.address() as { port: number }).port,
    close: async () => {
      stop('Bridge shutting down.'); clearInterval(heartbeat);
      for (const socket of server.clients) socket.terminate();
      await new Promise<void>(resolve => server.close(() => resolve()));
      await new Promise<void>(resolve => http.close(() => resolve()));
    },
  };
}
