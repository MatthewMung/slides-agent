import { beforeEach, afterEach, it, expect } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateImage, verifyDownloads } from '../src/files.js';
import { setupConfig, readConfig } from '../src/config.js';
let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'slides-agent-test-')); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
it('validates image signatures and rejects renamed executable content', async () => {
  const valid = join(directory, 'image.png');
  await writeFile(valid, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]));
  expect(await validateImage(valid)).toBe(valid);
  const fake = join(directory, 'fake.jpg'); await writeFile(fake, 'MZ not an image');
  await expect(validateImage(fake)).rejects.toMatchObject({ code: 'INVALID_FILE' });
  await expect(validateImage('relative.png')).rejects.toMatchObject({ code: 'INVALID_FILE' });
});
it('requires complete existing files with matching export headers', async () => {
  const pdf = join(directory, 'slides.pdf'); await writeFile(pdf, '%PDF-1.7\nexample');
  const bad = join(directory, 'wrong.pptx'); await writeFile(bad, '<html>Error</html>');
  const result = await verifyDownloads({ downloads: [
    { state: 'complete', filename: pdf }, { state: 'complete', filename: bad },
    { state: 'complete', filename: join(directory, 'missing.pdf') }, { state: 'in_progress', filename: pdf },
  ] });
  expect(result.downloads.map((item: any) => item.verified)).toEqual([true, false, false, false]);
});
it('keeps credentials outside source and supports stable setup and rotation', async () => {
  const path = join(directory, 'config.json');
  const original = await setupConfig({ path });
  expect(await setupConfig({ path })).toEqual(original);
  const rotated = await setupConfig({ path, rotate: true, port: 32146 });
  expect(rotated.token).not.toEqual(original.token);
  expect(await readConfig(path)).toEqual(rotated);
});
