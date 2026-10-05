import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { AgentError, DEFAULT_PORT } from './protocol.js';

const schema = z.object({ version: z.literal(1), port: z.number().int().min(1024).max(65535), token: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type Config = z.infer<typeof schema>;
export function configPath(): string {
  return process.env.SLIDES_AGENT_CONFIG ?? join(process.env.APPDATA ?? join(homedir(), '.config'), 'slides-agent', 'config.json');
}
export async function readConfig(path = configPath()): Promise<Config> {
  try { return schema.parse(JSON.parse(await readFile(path, 'utf8'))); }
  catch { throw new AgentError('CONFIG_REQUIRED', 'Run npm run setup first. Configuration must remain outside the repository.'); }
}
export async function setupConfig(options: { rotate?: boolean; port?: number; path?: string } = {}): Promise<Config> {
  const path = options.path ?? configPath();
  if (!options.rotate) {
    try { const current = await readConfig(path); if (options.port && options.port !== current.port) throw new AgentError('CONFIG_EXISTS', 'Use setup --rotate --port to change the port.'); return current; }
    catch (error) { if (error instanceof AgentError && error.code === 'CONFIG_EXISTS') throw error; }
  }
  const config = schema.parse({ version: 1, port: options.port ?? DEFAULT_PORT, token: randomBytes(32).toString('hex') });
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(temporary, JSON.stringify(config, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  await rename(temporary, path);
  return config;
}
