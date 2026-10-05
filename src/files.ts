import { open, realpath, stat } from 'node:fs/promises';
import { isAbsolute, extname } from 'node:path';
import { AgentError } from './protocol.js';

export async function validateImage(path: string): Promise<string> {
  if (!isAbsolute(path)) throw new AgentError('INVALID_FILE', 'Use an absolute local image path.');
  const resolved = await realpath(path).catch(() => { throw new AgentError('INVALID_FILE', 'Image does not exist.'); });
  const info = await stat(resolved);
  if (!info.isFile() || info.size === 0 || info.size >= 50 * 1024 * 1024) throw new AgentError('INVALID_FILE', 'Image must be a nonempty file smaller than 50 MB.');
  const file = await open(resolved, 'r');
  const bytes = Buffer.alloc(12);
  try { await file.read(bytes, 0, 12, 0); } finally { await file.close(); }
  const extension = extname(resolved).toLowerCase();
  const valid = extension === '.png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : ['.jpg', '.jpeg'].includes(extension) ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : extension === '.gif' ? ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii')) : false;
  if (!valid) throw new AgentError('INVALID_FILE', 'Only PNG, JPEG and GIF images with matching file signatures are supported.');
  return resolved;
}
export async function verifyDownloads(result: any): Promise<any> {
  if (!result || !Array.isArray(result.downloads)) throw new AgentError('INVALID_RESPONSE', 'Invalid download response.');
  return { ...result, downloads: await Promise.all(result.downloads.map(async (item: any) => {
    if (item.state !== 'complete') return { ...item, verified: false };
    let valid = false;
    try {
      const info = await stat(item.filename);
      valid = info.isFile() && info.size > 0;
      if (valid && /\.(pdf|pptx)$/i.test(item.filename)) {
        const file = await open(item.filename, 'r');
        const head = Buffer.alloc(5);
        try { await file.read(head, 0, 5, 0); } finally { await file.close(); }
        valid = /\.pdf$/i.test(item.filename) ? head.toString('ascii') === '%PDF-' : head[0] === 80 && head[1] === 75;
      }
    } catch { valid = false; }
    return { ...item, verified: valid, verification: valid ? 'file_exists_and_header_matches' : 'file_missing_empty_or_wrong_header' };
  })) };
}
