import archiver from 'archiver';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, copyFile } from 'node:fs/promises';
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
await mkdir('release', { recursive: true });
async function zip(name, entries) {
  const output = createWriteStream(`release/${name}`);
  const archive = archiver('zip', { zlib: { level: 9 } });
  const completed = new Promise((resolve, reject) => { output.on('close', resolve); output.on('error', reject); archive.on('error', reject); });
  archive.pipe(output);
  for (const [source, target, directory] of entries) directory ? archive.directory(source, target) : archive.file(source, { name: target });
  await archive.finalize(); await completed;
}
await zip(`slides-agent-extension-${version}.zip`, [['dist/extension', false, true], ['LICENSE', 'LICENSE', false]]);
await zip(`slides-agent-${version}.zip`, [
  ['dist', 'dist', true], ['src', 'src', true], ['extension', 'extension', true], ['scripts', 'scripts', true],
  ['tests', 'tests', true], ['skills', 'skills', true], ['docs', 'docs', true], ['.github', '.github', true],
  ...['package.json', 'package-lock.json', 'tsconfig.json', 'vitest.config.ts', 'README.md', 'README.zh-TW.md', 'LICENSE', 'AGENTS.md', '.gitignore', '.gitattributes'].map(file => [file, file, false]),
]);
await copyFile('docs/VALIDATION.md', 'release/VALIDATION.md');
console.log(`Release ZIPs created for ${version}. No local configuration or browser profile is included.`);
