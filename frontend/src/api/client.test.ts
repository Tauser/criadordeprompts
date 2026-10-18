import {afterEach, expect, it, vi} from 'vitest';
import {api, ApiError} from './client';

afterEach(() => vi.unstubAllGlobals());

it.each(['<html>proxy error</html>', 'null', '[]', '"ok"'])('rejects invalid successful JSON: %s', async body => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body, {status: 200})));
  await expect(api.health()).rejects.toThrow('Resposta inválida');
});

it('preserves HTTP errors when the response body is null', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('null', {status: 503})));
  await expect(api.health()).rejects.toMatchObject({status: 503});
  await expect(api.health()).rejects.toBeInstanceOf(ApiError);
});
