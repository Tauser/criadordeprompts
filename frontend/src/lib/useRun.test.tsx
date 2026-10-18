// @vitest-environment happy-dom
import {act, cleanup, renderHook, waitFor} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import {api} from '../api/client';
import type {Run} from '../api/types';
import {useRun} from './useRun';

vi.mock('../api/client', async importOriginal => ({...await importOriginal<typeof import('../api/client')>(),
  api: {run: vi.fn()}}));
afterEach(() => {cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); Source.instances = [];});

class Source extends EventTarget {
  static instances: Source[] = [];
  onerror: (() => void) | null = null;
  close = vi.fn();
  constructor(_url: string) {super(); Source.instances.push(this);}
  snapshot(run: Run) {this.dispatchEvent(new MessageEvent('snapshot', {data: JSON.stringify(run)}));}
}
const run = (id: string, status: string) => ({id, status, images: []} as unknown as Run);

it('does not overwrite a newer snapshot with the late initial GET', async () => {
  let resolve!: (run: Run) => void;
  vi.mocked(api.run).mockReturnValue(new Promise<Run>(done => {resolve = done;}));
  vi.stubGlobal('EventSource', Source);
  const {result} = renderHook(() => useRun('first'));
  act(() => Source.instances[0].snapshot(run('first', 'completed')));
  await act(async () => resolve(run('first', 'generating')));
  expect(result.current.run?.status).toBe('completed');
});

it('ignores queued events from a previously selected run', async () => {
  vi.mocked(api.run).mockImplementation(async id => run(id, 'generating'));
  vi.stubGlobal('EventSource', Source);
  const {result, rerender} = renderHook(({id}) => useRun(id), {initialProps: {id: 'first'}});
  await waitFor(() => expect(result.current.run?.id).toBe('first'));
  rerender({id: 'second'});
  await waitFor(() => expect(result.current.run?.id).toBe('second'));
  act(() => Source.instances[0].snapshot(run('first', 'completed')));
  expect(result.current.run?.id).toBe('second');
});

it('starts only one polling loop when SSE emits repeated errors', async () => {
  vi.mocked(api.run).mockResolvedValue(run('first', 'completed'));
  vi.stubGlobal('EventSource', Source);
  renderHook(() => useRun('first'));
  act(() => {Source.instances[0].onerror?.(); Source.instances[0].onerror?.();});
  await waitFor(() => expect(api.run).toHaveBeenCalledTimes(2));
});
