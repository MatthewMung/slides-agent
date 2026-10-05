import { beforeEach, afterEach, it, expect } from 'vitest';
import { WebSocket } from 'ws';
import { randomBytes, randomUUID } from 'node:crypto';
import { createBridge } from '../src/bridge.js';
import { BridgeClient } from '../src/client.js';
import type { Config } from '../src/config.js';
let bridge: Awaited<ReturnType<typeof createBridge>>;
let config: Config;
let extension: WebSocket;
const clients: BridgeClient[] = [];
let stopEvents: string[];
let ignoreObserve = false;
beforeEach(async () => {
  config = { version: 1, port: 0, token: randomBytes(32).toString('hex') };
  bridge = await createBridge(config, { requestTimeout: 300 }); config.port = bridge.port;
  stopEvents = []; ignoreObserve = false;
  extension = new WebSocket(`ws://127.0.0.1:${config.port}`, { origin: `chrome-extension://${'a'.repeat(32)}` });
  extension.on('message', raw => {
    const message = JSON.parse(raw.toString());
    if (message.type === 'stop') { stopEvents.push(message.reason); return; }
    if (message.type !== 'request' || (ignoreObserve && message.method === 'observe')) return;
    extension.send(JSON.stringify({ type: 'response', id: message.id, result: message.method === 'start_session' ? { sessionId: randomUUID() } : { ok: true } }));
  });
  await new Promise<void>((resolve, reject) => {
    extension.on('open', () => extension.send(JSON.stringify({ type: 'hello', version: 1, role: 'extension', token: config.token })));
    extension.on('message', raw => { if (JSON.parse(raw.toString()).type === 'ready') resolve(); });
    extension.on('error', reject);
  });
});
afterEach(async () => { clients.splice(0).forEach(client => client.close()); extension.terminate(); await bridge.close(); });
function client() { const value = new BridgeClient(config); clients.push(value); return value; }
it('requires a correct credential and rejects browser-origin MCP impersonation', async () => {
  const rejected = async (origin: string | undefined, token: string) => {
    const socket = new WebSocket(`ws://127.0.0.1:${config.port}`, origin ? { origin } : {});
    socket.on('open', () => socket.send(JSON.stringify({ type: 'hello', version: 1, role: 'mcp', token })));
    return new Promise<number>(resolve => socket.on('close', code => resolve(code)));
  };
  expect(await rejected(undefined, 'wrong')).toBe(1008);
  expect(await rejected('https://evil.test', config.token)).toBe(1008);
});
it('isolates sessions between MCP clients and rejects stale owners', async () => {
  const first = client(), second = client();
  const session = await first.request('start_session', { tabId: 12 });
  await expect(second.request('start_session', { tabId: 13 })).rejects.toMatchObject({ code: 'SESSION_IN_USE' });
  await expect(second.request('observe', { sessionId: session.sessionId })).rejects.toMatchObject({ code: 'SESSION_NOT_OWNED' });
  await first.request('end_session', { sessionId: session.sessionId });
  expect((await second.request('start_session', { tabId: 13 })).sessionId).toBeTruthy();
});
it('stops control on owner disconnection without replaying an operation', async () => {
  const first = client(); await first.request('start_session', { tabId: 12 }); first.close();
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(stopEvents).toContain('MCP client disconnected.');
  expect((await client().request('get_status')).controlling).toBe(false);
});
it('stops and reports unknown state after timeout', async () => {
  const first = client(); const session = await first.request('start_session', { tabId: 12 });
  ignoreObserve = true;
  await expect(first.request('observe', { sessionId: session.sessionId })).rejects.toMatchObject({ code: 'OPERATION_TIMEOUT' });
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(stopEvents).toContain('Operation timed out; no automatic replay.');
  expect((await first.request('get_status')).controlling).toBe(false);
});
it('rejects malformed tool params before forwarding', async () => {
  await expect(client().request('start_session', { tabId: 1, script: 'extra' })).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
});
it('MCP request cancellation immediately releases control', async () => {
  const first = client(); const session = await first.request('start_session', { tabId: 12 });
  ignoreObserve = true;
  const abort = new AbortController();
  const operation = first.request('observe', { sessionId: session.sessionId }, abort.signal);
  const rejection = expect(operation).rejects.toMatchObject({ code: 'REQUEST_CANCELLED' });
  await new Promise(resolve => setTimeout(resolve, 20)); abort.abort();
  await rejection;
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(stopEvents).toContain('MCP client disconnected.');
  expect((await client().request('get_status')).controlling).toBe(false);
});
