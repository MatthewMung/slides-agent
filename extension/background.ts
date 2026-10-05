import { SlidesController } from './controller.js';
import { errorInfo, toolSchemas, WIRE_VERSION, type Method } from '../src/protocol.js';

let socket: WebSocket | undefined;
let generation = 0;
let queue = Promise.resolve();
let state = 'Disconnected';
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let reconnectAttempt = 0;
let enabled = false;
const send = (data: unknown) => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data)); };
const controller = new SlidesController(reason => { send({ type: 'stopped', reason }); });
function setState(value: string) {
  state = value;
  void chrome.action.setBadgeText({ text: value === 'Connected' ? 'ON' : '' });
}
async function disconnect() {
  enabled = false; generation++;
  clearTimeout(reconnectTimer);
  const previous = socket; socket = undefined;
  await controller.stop('Disconnected'); previous?.close(); setState('Disconnected');
}
async function connect() {
  clearTimeout(reconnectTimer);
  const stored = await chrome.storage.local.get(['port', 'token', 'enabled']);
  enabled = stored.enabled === true;
  if (!enabled || typeof stored.token !== 'string' || !/^[a-f0-9]{64}$/.test(stored.token) || typeof stored.port !== 'number' || !Number.isInteger(stored.port) || stored.port < 1024 || stored.port > 65535) { setState('Configure pairing first'); return; }
  if (socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)) return;
  const ws = new WebSocket(`ws://127.0.0.1:${stored.port}`);
  socket = ws;
  setState('Connecting');
  ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', role: 'extension', version: WIRE_VERSION, token: stored.token }));
  ws.onmessage = event => {
    let data: any;
    try { data = JSON.parse(event.data); } catch { ws.close(); return; }
    if (data.type === 'ready') { reconnectAttempt = 0; setState('Connected'); return; }
    if (data.type === 'heartbeat') { send({ type: 'heartbeat' }); return; }
    if (data.type === 'stop') { generation++; void controller.stop('Bridge stopped control', false); return; }
    if (data.type !== 'request') return;
    const receivedGeneration = generation;
    queue = queue.catch(() => {}).then(async () => {
      let response: any = { type: 'response', id: data.id };
      try {
        if (receivedGeneration !== generation || socket !== ws) throw new Error('Control cancelled before execution');
        const method = data.method as Method;
        if (!Object.hasOwn(toolSchemas, method)) throw new Error('Unsupported tool');
        const params = toolSchemas[method].parse(data.params);
        response.result = await controller.dispatch(method, params);
      } catch (error) { response.error = errorInfo(error); }
      if (socket === ws) send(response);
    });
  };
  ws.onerror = () => { setState('Bridge unavailable'); };
  ws.onclose = () => {
    if (socket !== ws) return;
    socket = undefined; generation++;
    void controller.stop('Bridge disconnected', false);
    setState('Disconnected');
    if (enabled) reconnectTimer = setTimeout(() => void connect(), Math.min(30000, 1000 * 2 ** reconnectAttempt++));
  };
}
chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message.type === 'status') { respond({ state, ...controller.status }); return false; }
  if (message.type === 'connect') { void disconnect().then(connect).then(() => respond({ state })).catch(() => respond({ state: 'Connection failed' })); return true; }
  if (message.type === 'stop') { generation++; void controller.stop('Stopped from extension popup').then(() => respond({ stopped: true })); return true; }
  if (message.type === 'disconnect') { void chrome.storage.local.set({ enabled: false }).then(disconnect).then(() => respond({ state })); return true; }
  return false;
});
chrome.runtime.onStartup.addListener(() => void connect());
void connect();
