import {afterEach, expect, it, vi} from 'vitest';
import {uuid} from './uuid';

afterEach(() => vi.unstubAllGlobals());

it('uses native randomUUID when available', () => {
  const randomUUID = vi.fn(() => 'bc117375-b7fe-492f-8485-5f20841cb39e');
  vi.stubGlobal('crypto', {randomUUID});
  expect(uuid()).toBe('bc117375-b7fe-492f-8485-5f20841cb39e');
  expect(randomUUID).toHaveBeenCalledOnce();
});

it('creates a version 4 UUID from secure random bytes when randomUUID is unavailable on HTTP', () => {
  const getRandomValues = vi.fn((bytes: Uint8Array) => {
    bytes.set(Array.from({length: 16}, (_, i) => i * 17));
    return bytes;
  });
  vi.stubGlobal('crypto', {getRandomValues});
  expect(uuid()).toBe('00112233-4455-4677-8899-aabbccddeeff');
  expect(getRandomValues).toHaveBeenCalledOnce();
});
