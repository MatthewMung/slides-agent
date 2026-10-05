import { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import type { Config } from './config.js';
import { AgentError, WIRE_VERSION, type Method, type Params } from './protocol.js';

export class BridgeClient {
  private socket?: WebSocket;
  private connecting?: Promise<void>;
  private pending = new Map<string, { resolve: (result: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  constructor(private config: Config) {}
  async connect(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN && !this.connecting) return;
    if (this.connecting) return this.connecting;
    this.connecting = new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${this.config.port}`);
      this.socket = socket;
      const timer = setTimeout(() => { socket.terminate(); reject(new AgentError('BRIDGE_OFFLINE', 'Bridge handshake timed out. Run npm run bridge.')); }, 5000);
      socket.on('open', () => socket.send(JSON.stringify({ type: 'hello', version: WIRE_VERSION, role: 'mcp', token: this.config.token })));
      socket.on('message', raw => {
        let data: any;
        try { data = JSON.parse(raw.toString()); } catch { socket.terminate(); return; }
        if (data.type === 'ready') { clearTimeout(timer); resolve(); return; }
        if (data.type === 'heartbeat') { socket.send(JSON.stringify({ type: 'heartbeat' })); return; }
        if (data.type !== 'response') return;
        const item = this.pending.get(data.id);
        if (!item) return;
        clearTimeout(item.timer); this.pending.delete(data.id);
        if (data.error) item.reject(new AgentError(data.error.code, data.error.message)); else item.resolve(data.result);
      });
      socket.on('error', () => { clearTimeout(timer); reject(new AgentError('BRIDGE_OFFLINE', 'Cannot connect to bridge. Run npm run bridge.')); });
      socket.on('close', () => {
        clearTimeout(timer);
        if (this.socket === socket) this.socket = undefined;
        reject(new AgentError('BRIDGE_OFFLINE', 'Bridge closed the connection.'));
        for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new AgentError('BRIDGE_OFFLINE', 'Connection lost. Observe again before retrying any edit.')); }
        this.pending.clear();
      });
    });
    try { await this.connecting; } finally { this.connecting = undefined; }
  }
  async request(method: Method, params: Params = {}, signal?: AbortSignal): Promise<any> {
    if (signal?.aborted) throw new AgentError('REQUEST_CANCELLED', 'Request cancelled before execution.');
    await this.connect();
    if (signal?.aborted) { this.socket?.terminate(); throw new AgentError('REQUEST_CANCELLED', 'Request cancelled before execution.'); }
    const socket = this.socket!;
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); this.pending.delete(id); };
      const cancel = () => {
        cleanup(); socket.terminate();
        reject(new AgentError('REQUEST_CANCELLED', 'Control cancelled. Result may be unknown; observe before retrying.'));
      };
      const timer = setTimeout(() => {
        cleanup(); socket.terminate();
        reject(new AgentError('OPERATION_TIMEOUT', 'Result unknown; connection closed to stop control. Do not replay edits automatically.'));
      }, 35000);
      this.pending.set(id, { resolve: result => { cleanup(); resolve(result); }, reject: error => { cleanup(); reject(error); }, timer });
      signal?.addEventListener('abort', cancel, { once: true });
      socket.send(JSON.stringify({ type: 'request', id, method, params }));
    });
  }
  close(): void { this.socket?.close(); }
}
