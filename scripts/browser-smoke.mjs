// Real Chromium + our actual extension + local bridge + MCP stdio, against routed fixtures.
// This does NOT verify Google's production Slides editor.
import { chromium } from 'playwright';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createBridge } from '../dist/src/bridge.js';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve('.browser-test');
await mkdir(root, { recursive: true });
const temporary = await mkdtemp(join(root, 'run-'));
const config = { version: 1, port: 0, token: randomBytes(32).toString('hex') };
const bridge = await createBridge(config);
config.port = bridge.port;
const configFile = join(temporary, 'config.json');
await writeFile(configFile, JSON.stringify(config));
let context, client;
const results = [];
const record = name => { results.push(name); console.log(`PASS ${name}`); };
try {
  const extension = resolve('dist/extension');
  context = await chromium.launchPersistentContext(join(temporary, 'chrome'), {
    channel: 'chromium', headless: process.env.SLIDES_AGENT_HEADFUL !== '1',
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    viewport: { width: 1000, height: 750 }, deviceScaleFactor: Number(process.env.SLIDES_AGENT_SCALE ?? 1), acceptDownloads: true,
  });
  const fixture = `<!doctype html><meta charset="utf-8"><title>Slides Agent fixture</title>
    <style>body{font:20px sans-serif;padding:25px}textarea{display:block;width:400px;height:120px}button{padding:15px;margin:8px}#box{width:120px;height:80px;background:#a5c7ff;user-select:none}</style>
    <h1>Local test presentation</h1><textarea aria-label="Slide text">Before</textarea>
    <button id="animate" onclick="document.querySelector('#box').textContent='Animation enabled'">Add animation</button>
    <button id="upload" onclick="document.querySelector('input').click()">Upload image</button>
    <input type="file" accept="image/*" hidden onchange="document.querySelector('#imageStatus').textContent=this.files[0].name">
    <div id="imageStatus"></div><div id="box" draggable="false" onpointerdown="this.dataset.drag='started'" onpointerup="this.dataset.drag='ended'" ondblclick="this.dataset.double='yes'" oncontextmenu="event.preventDefault();this.dataset.context='yes'">Object</div>
    <button id="export" onclick="location.href='/presentation/d/fixture/export/pdf'">Export PDF</button>
    <iframe title="nested file picker" src="https://drive.google.com/fixture-upload"></iframe>`;
  await context.route('https://docs.google.com/presentation/**', async route => {
    if (route.request().url().endsWith('/export/pdf')) return route.fulfill({ status: 200, headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="fixture.pdf"' }, body: '%PDF-1.7\n% local fixture\n%%EOF' });
    await route.fulfill({ status: 200, contentType: 'text/html', body: fixture });
  });
  await context.route('https://drive.google.com/fixture-upload', route => route.fulfill({ contentType: 'text/html', body: '<button id="child-upload" onclick="document.querySelector(\'input\').click()">Upload inside frame</button><input type="file" hidden onchange="document.body.dataset.uploaded=this.files[0].name">' }));
  await context.route('https://docs.google.com/document/**', route => route.fulfill({ contentType: 'text/html', body: 'Outside Slides' }));
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.locator('#port').fill(String(config.port));
  await popup.locator('#token').fill(config.token);
  await popup.locator('button[type=submit]').click();
  await popup.locator('#status').filter({ hasText: 'Connected' }).waitFor();
  await popup.close();
  const page = await context.newPage();
  await page.goto('https://docs.google.com/presentation/d/fixture/edit');
  client = new Client({ name: 'slides-agent-browser-test', version: '0.1.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [resolve('dist/src/cli.js'), 'mcp'], env: { ...Object.fromEntries(Object.entries(process.env).filter(([, value]) => typeof value === 'string')), SLIDES_AGENT_CONFIG: configFile } }));
  const tools = await client.listTools(); assert.equal(tools.tools.length, 8); record('MCP stdio exposes all eight tools');
  async function tool(name, args = {}, expectError = false) {
    const result = await client.callTool({ name, arguments: args });
    const metadata = JSON.parse(result.content.find(item => item.type === 'text').text);
    if (!expectError && result.isError) throw new Error(`${name}: ${JSON.stringify(metadata)}`);
    return { result, metadata };
  }
  const { metadata: tabs } = await tool('list_tabs');
  const tabId = tabs.tabs.find(tab => tab.url.endsWith('/fixture/edit')).tabId;
  let { metadata: observation } = await tool('start_session', { tabId });
  const sessionId = observation.sessionId;
  async function observe() { observation = (await tool('observe', { sessionId })).metadata; return observation; }
  async function act(action) {
    // Wait for prior input invalidation events before taking the next observation.
    await observe();
    const result = await tool('act', { sessionId, snapshotId: observation.snapshotId, action });
    observation = result.metadata; return result;
  }
  async function click(selector) {
    const box = await page.locator(selector).boundingBox();
    assert(box); return act({ type: 'click', x: box.x + box.width / 2, y: box.y + box.height / 2 });
  }
  const firstSnapshot = observation.snapshotId;
  assert.equal(observation.viewport.width, 1000);
  assert(observation.screenshot.cssToImageX > 0); record('Screenshot and CSS coordinate mapping');
  await click('textarea');
  await act({ type: 'press_key', key: 'a', modifiers: ['Control'] });
  await act({ type: 'type_text', text: 'Hello 你好' });
  assert.equal(await page.locator('textarea').inputValue(), 'Hello 你好'); record('Trusted click, shortcut and Unicode typing');
  const stale = await tool('act', { sessionId, snapshotId: firstSnapshot, action: { type: 'click', x: 0, y: 0 } }, true);
  assert.equal(stale.metadata.code, 'STALE_SNAPSHOT'); record('Consumed snapshot cannot replay an edit');
  await click('#animate');
  assert.equal(await page.locator('#box').textContent(), 'Animation enabled'); record('Menu-like button action verified in DOM');
  const objectBox = await page.locator('#box').boundingBox(); assert(objectBox);
  await act({ type: 'double_click', x: objectBox.x + 20, y: objectBox.y + 20 });
  assert.equal(await page.locator('#box').getAttribute('data-double'), 'yes');
  await act({ type: 'right_click', x: objectBox.x + 20, y: objectBox.y + 20 });
  assert.equal(await page.locator('#box').getAttribute('data-context'), 'yes');
  await act({ type: 'drag', from: { x: objectBox.x + 20, y: objectBox.y + 20 }, to: { x: objectBox.x + 50, y: objectBox.y + 40 } });
  assert.equal(await page.locator('#box').getAttribute('data-drag'), 'ended'); record('Double click, right click and drag input sequences');
  await observe(); const beforeManualInput = observation.snapshotId;
  await page.locator('textarea').click();
  const manual = await tool('act', { sessionId, snapshotId: beforeManualInput, action: { type: 'type_text', text: 'should not be sent' } }, true);
  assert.equal(manual.metadata.code, 'STALE_SNAPSHOT'); record('Manual input invalidates snapshot');
  const image = join(temporary, 'test.png');
  await writeFile(image, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lRcAAAAASUVORK5CYII=', 'base64'));
  await click('#upload');
  await observe(); assert(observation.pendingUpload);
  const cancelledChooser = observation.pendingUpload.chooserId;
  await act({ type: 'press_key', key: 'Escape' });
  const cancelledUpload = await tool('upload_file', { sessionId, chooserId: cancelledChooser, path: image }, true);
  assert.equal(cancelledUpload.metadata.code, 'NO_FILE_CHOOSER'); record('Cancelled chooser cannot be reused');
  await click('#upload');
  await observe(); assert(observation.pendingUpload);
  await tool('upload_file', { sessionId, chooserId: observation.pendingUpload.chooserId, path: image });
  assert.equal(await page.locator('#imageStatus').textContent(), 'test.png'); record('Intercepted root-frame local image upload');
  // Cross-origin OOPIF upload exercises flat child debugger sessions.
  const child = page.frameLocator('iframe').locator('#child-upload');
  const childBox = await child.boundingBox(); assert(childBox);
  await act({ type: 'click', x: childBox.x + childBox.width / 2, y: childBox.y + childBox.height / 2 });
  await observe(); assert(observation.pendingUpload);
  await tool('upload_file', { sessionId, chooserId: observation.pendingUpload.chooserId, path: image });
  assert.equal(await page.frames().find(frame => frame.url().includes('drive.google.com')).evaluate(() => document.body.dataset.uploaded), 'test.png'); record('Cross-origin iframe image upload');
  await observe(); const preResize = observation.snapshotId;
  await page.setViewportSize({ width: 1100, height: 800 });
  const resized = await tool('act', { sessionId, snapshotId: preResize, action: { type: 'click', x: 50, y: 50 } }, true);
  assert.equal(resized.metadata.code, 'STALE_SNAPSHOT'); record('Resize rejects obsolete coordinates');
  const downloadEvent = page.waitForEvent('download');
  await click('#export');
  const download = await downloadEvent;
  const downloadedPath = await download.path(); assert(downloadedPath);
  const downloaded = await readFile(downloadedPath); assert(downloaded.toString().startsWith('%PDF-'));
  const { metadata: downloads } = await tool('get_downloads', { sessionId });
  assert.equal(downloads.downloads.length, 1); assert.equal(downloads.downloads[0].verified, true); record('PDF download attributed and verified on disk');
  // Popup stop should invalidate ownership while leaving the bridge usable.
  const controlPopup = await context.newPage();
  await controlPopup.goto(`chrome-extension://${extensionId}/popup.html`);
  await controlPopup.locator('#stop').click();
  await new Promise(resolve => setTimeout(resolve, 100));
  const stopped = await tool('observe', { sessionId }, true); assert.equal(stopped.metadata.code, 'SESSION_NOT_OWNED'); record('Emergency stop revokes session');
  await controlPopup.close();
  await page.bringToFront();
  const restarted = await tool('start_session', { tabId });
  await page.goto('https://docs.google.com/document/d/other/edit');
  await new Promise(resolve => setTimeout(resolve, 100));
  const navigation = await tool('observe', { sessionId: restarted.metadata.sessionId }, true); assert(navigation.result.isError); record('Leaving Slides revokes control');
  await mkdir('artifacts', { recursive: true });
  await writeFile(`artifacts/browser-smoke-${process.env.SLIDES_AGENT_SCALE ?? '1'}.json`, JSON.stringify({ timestamp: new Date().toISOString(), browserVersion: context.browser()?.version() ?? 'persistent Chromium', environment: process.platform, emulatedDeviceScale: Number(process.env.SLIDES_AGENT_SCALE ?? 1), type: 'routed_local_fixture_not_google_slides', results }, null, 2));
  console.log(`${results.length} browser checks passed. Production Google Slides remains unverified.`);
} finally {
  await client?.close();
  await context?.close();
  await bridge.close();
  const safe = relative(root, temporary);
  if (!safe.startsWith('..') && !safe.startsWith('/') && safe) await rm(temporary, { recursive: true, force: true });
}
