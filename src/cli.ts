import { readConfig, setupConfig, configPath } from './config.js';
import { createBridge } from './bridge.js';
import { BridgeClient } from './client.js';
import { runMcp } from './mcp.js';
import { errorInfo } from './protocol.js';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

async function main() {
  const command = process.argv[2];
  if (command === 'setup') {
    const portArg = process.argv.indexOf('--port');
    const config = await setupConfig({ rotate: process.argv.includes('--rotate'), port: portArg === -1 ? undefined : Number(process.argv[portArg + 1]) });
    console.log(`Saved local configuration: ${configPath()}\nBridge port: ${config.port}`);
    if (process.argv.includes('--show-token')) console.log(`Pairing token (local secret; paste only into the extension):\n${config.token}`);
    else console.log('Run npm run setup -- --show-token to display your token locally.');
    console.log('\nCodex MCP config (replace any existing slides-agent block):');
    console.log(`[mcp_servers.slides-agent]\ncommand = "node"\nargs = [${JSON.stringify(fileURLToPath(new URL('./cli.js', import.meta.url)))}, "mcp"]`);
    return;
  }
  if (command === 'bridge') {
    const bridge = await createBridge(await readConfig());
    console.error(`Slides Agent bridge listening on 127.0.0.1:${bridge.port}. Ctrl+C stops all control.`);
    let closing = false;
    const shutdown = async () => { if (closing) return; closing = true; await bridge.close(); process.exit(0); };
    process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
    return;
  }
  if (command === 'doctor') {
    const client = new BridgeClient(await readConfig());
    try { console.log(JSON.stringify(await client.request('get_status'), null, 2)); } finally { client.close(); }
    return;
  }
  if (command === 'mcp') { await runMcp(); return; }
  console.error('Usage: node dist/src/cli.js setup [--show-token] [--rotate] [--port 32145] | bridge | doctor | mcp');
  process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(JSON.stringify(errorInfo(error))); process.exitCode = 1; });
