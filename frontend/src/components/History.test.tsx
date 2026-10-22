// @vitest-environment happy-dom
import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import {api} from '../api/client';
import type {Run} from '../api/types';
import {History} from './History';

vi.mock('../api/client', () => ({api: {runs: vi.fn(), deleteRuns: vi.fn()}, fileUrl: (hash: string) => hash}));
afterEach(() => {cleanup(); vi.clearAllMocks();});

const NOW = Date.now() / 1000;
const run = (id: string, prompt: string, extra: Partial<Run> = {}): Run => ({
  id, request_id: `request-${id}`, status: 'completed', mode: 'generate', prompt, effective_prompt: prompt,
  refined_prompt: null, error: null, best_task_id: null, cancel_requested: false, created_at: NOW - 60,
  updated_at: NOW, images: [], settings: {} as Run['settings'], ...extra,
} as unknown as Run);

const renderHistory = () => render(<History activeRun={null} onSelect={() => undefined} keepFiles={[]}
  notify={() => undefined} />);

it('searches on the server after a short pause and shows "Nada encontrado." for no hits', async () => {
  vi.mocked(api.runs).mockResolvedValue({runs: [run('a', 'praia ao entardecer')], next_before: null});
  renderHistory();
  expect(await screen.findByText('praia ao entardecer')).toBeTruthy();

  vi.mocked(api.runs).mockResolvedValue({runs: [], next_before: null});
  fireEvent.change(screen.getByRole('searchbox', {name: 'Buscar no histórico'}), {target: {value: '  xyz  '}});
  expect(await screen.findByText('Nada encontrado.')).toBeTruthy();
  expect(vi.mocked(api.runs)).toHaveBeenLastCalledWith({q: 'xyz', limit: 30});
  expect(vi.mocked(api.runs).mock.calls.filter(([p]) => p?.q === 'xyz')).toHaveLength(1);   // one request, after the pause
});

it('filters by Geração and Edição on the server', async () => {
  vi.mocked(api.runs).mockResolvedValueOnce({runs: [run('a', 'primeira')], next_before: null});
  renderHistory();
  await screen.findByText('primeira');

  vi.mocked(api.runs).mockResolvedValueOnce({runs: [run('b', 'foto editada', {mode: 'edit'})], next_before: null});
  fireEvent.click(screen.getByRole('button', {name: 'Edição'}));
  expect(await screen.findByText('foto editada')).toBeTruthy();
  expect(vi.mocked(api.runs)).toHaveBeenLastCalledWith({mode: 'edit', limit: 30});
  expect(screen.queryByText('primeira')).toBeNull();
});

it('loads the next page from next_before and appends it without repeats', async () => {
  const first = Array.from({length: 9}, (_, i) => run(`r${i}`, `pagina um ${i}`, {created_at: NOW - 10 - i}));
  vi.mocked(api.runs).mockResolvedValueOnce({runs: first, next_before: NOW - 18});
  renderHistory();
  await screen.findByText('pagina um 0');
  fireEvent.click(screen.getByRole('button', {name: 'Ver todos (9)'}));

  vi.mocked(api.runs).mockResolvedValueOnce({runs: [run('z', 'pagina dois', {created_at: NOW - 99})], next_before: null});
  fireEvent.click(await screen.findByRole('button', {name: 'Carregar mais'}));
  expect(await screen.findByText('pagina dois')).toBeTruthy();
  expect(vi.mocked(api.runs)).toHaveBeenLastCalledWith({limit: 30, before: NOW - 18});
  await waitFor(() => expect(screen.queryByRole('button', {name: 'Carregar mais'})).toBeNull());
});
