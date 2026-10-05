import { describe, it, expect } from 'vitest';
import { actionSchema, assertPoint, keyDefinition, matchesDownload, modifierMask, presentationId } from '../src/protocol.js';

describe('presentation boundaries', () => {
  it('accepts Slides editor, slideshow and account-prefixed URLs', () => {
    expect(presentationId('https://docs.google.com/presentation/d/abc-123/edit#slide=id.p')).toBe('abc-123');
    expect(presentationId('https://docs.google.com/presentation/u/0/d/abc/present')).toBe('abc');
  });
  it.each(['https://docs.google.com.evil.test/presentation/d/abc/edit', 'http://docs.google.com/presentation/d/abc', 'https://docs.google.com:444/presentation/d/abc', 'https://docs.google.com/document/d/abc/edit', 'chrome://settings', 'not a url'])('rejects %s', url => expect(presentationId(url)).toBeUndefined());
  it('attributes redirected downloads by referrer and rejects unrelated or old files', () => {
    const item = { url: 'https://googleusercontent.com/file', referrer: 'https://docs.google.com/presentation/d/abc/edit', startTime: new Date(1000).toISOString() };
    expect(matchesDownload(item, 'abc', 999)).toBe(true);
    expect(matchesDownload(item, 'other', 999)).toBe(false);
    expect(matchesDownload(item, 'abc', 1001)).toBe(false);
  });
});
describe('inputs and coordinates', () => {
  it('uses CSS viewport bounds independent of screenshot scale', () => {
    expect(() => assertPoint(999, 499, 1000, 500)).not.toThrow();
    expect(() => assertPoint(1000, 0, 1000, 500)).toThrow();
    expect(() => assertPoint(NaN, 0, 1000, 500)).toThrow();
  });
  it('rejects arbitrary actions, coordinates and extras', () => {
    expect(actionSchema.safeParse({ type: 'evaluate', expression: 'document.cookie' }).success).toBe(false);
    expect(actionSchema.safeParse({ type: 'click', x: -1, y: 2 }).success).toBe(false);
    expect(actionSchema.safeParse({ type: 'click', x: 1, y: 2, script: 'extra' }).success).toBe(false);
  });
  it('maps shortcuts without confusing Unicode text with keyboard codes', () => {
    expect(modifierMask(['Control', 'Shift'])).toBe(10);
    expect(keyDefinition('a')).toEqual({ key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 });
    expect(() => keyDefinition('你好')).toThrow();
  });
});
