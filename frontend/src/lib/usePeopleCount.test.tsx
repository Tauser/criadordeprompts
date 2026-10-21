// @vitest-environment happy-dom
import {cleanup, renderHook, waitFor} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import {api} from '../api/client';
import {usePeopleCount} from './usePeopleCount';

vi.mock('../api/client', async importOriginal => ({...await importOriginal<typeof import('../api/client')>(),
  api: {countPeople: vi.fn(), peopleCount: vi.fn(), cancelPeopleCount: vi.fn(() => Promise.resolve())}}));
afterEach(() => {cleanup(); vi.clearAllMocks();});

it('counts the people of a photo once and reports the number', async () => {
  vi.mocked(api.countPeople).mockResolvedValue({id: 'j1', status: 'completed', count: 2});
  const onCount = vi.fn();
  const {result, rerender} = renderHook(({wanted}) => usePeopleCount('abc', wanted, true, onCount), {initialProps: {wanted: true}});
  await waitFor(() => expect(result.current?.status).toBe('done'));
  expect(onCount).toHaveBeenCalledWith('abc', 2);
  rerender({wanted: false});
  rerender({wanted: true});
  expect(api.countPeople).toHaveBeenCalledTimes(1);
});

it('does not fill the field when no face is found or ComfyUI is offline', async () => {
  vi.mocked(api.countPeople).mockResolvedValue({id: 'j2', status: 'completed', count: 0});
  const onCount = vi.fn();
  const {result} = renderHook(() => usePeopleCount('def', true, true, onCount));
  await waitFor(() => expect(result.current?.status).toBe('done'));
  expect(onCount).not.toHaveBeenCalled();
  renderHook(() => usePeopleCount('ghi', true, false, onCount));
  expect(api.countPeople).toHaveBeenCalledTimes(1);
});

it('finds where the people are even when the count was typed, without changing it', async () => {
  vi.mocked(api.countPeople).mockResolvedValue({id: 'j3', status: 'completed', count: 2,
    people: [{x: 0.1, y: 0.2, width: 0.1, height: 0.1}, {x: 0.6, y: 0.2, width: 0.1, height: 0.1}]});
  const onCount = vi.fn();
  const {result} = renderHook(() => usePeopleCount('jkl', false, true, onCount));
  await waitFor(() => expect(result.current?.status).toBe('done'));
  expect(result.current?.people).toHaveLength(2);
  expect(onCount).not.toHaveBeenCalled();
});
