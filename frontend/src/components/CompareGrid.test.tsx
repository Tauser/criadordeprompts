// @vitest-environment happy-dom
import {cleanup, render, screen} from '@testing-library/react';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {api} from '../api/client';
import type {Item, Run, StudioRequest} from '../api/types';
import {CompareGrid, startComparison} from './CompareGrid';

vi.mock('../api/client', () => ({
  api: {createRun: vi.fn(), run: vi.fn()},
  fileUrl: (hash: string) => `/api/files/${hash}`,
}));

beforeEach(() => {
  vi.mocked(api.createRun).mockReset();
  vi.mocked(api.run).mockReset();
});
afterEach(cleanup);

const request = {
  mode: 'generate', output: {profile: 'turbo', resolution: 1024, aspect: '3:4', seed: null, variations: 4, verify: false, refine: false},
  attributes: {
    pose: {intent: 'set', value: {kind: 'catalog', item_id: 'pose-a'}},
    environment: {intent: 'set', value: {kind: 'catalog', item_id: 'env-a'}},
    style: {intent: 'free'},
  },
  content_mode: 'standard',
} as unknown as StudioRequest;

const run = {id: 'r1', status: 'completed', request, files: {references: {ref1: 'a'.repeat(64)}, mask: null},
  settings: {profile: 'turbo', seed: 100, variations: 4}, images: [], created_at: 1, updated_at: 2} as unknown as Run;

const items = [
  {id: 'pose-a', category: 'pose', label: 'Em pé', enabled: true, adult: false},
  {id: 'pose-b', category: 'pose', label: 'De costas', enabled: true, adult: false},
  {id: 'pose-c', category: 'pose', label: 'Sentada', enabled: true, adult: false},
] as unknown as Item[];

const sent = () => vi.mocked(api.createRun).mock.calls.map(([body]) => body);

it('Perfil sends Turbo and Completo with the same seed and one variation each', async () => {
  vi.mocked(api.createRun).mockResolvedValue({id: 'new'} as Run);
  const cells = await startComparison(run, {axis: 'profile'}, items);
  expect(sent().map(b => b.request.output.profile)).toEqual(['turbo', 'qwen21']);
  expect(sent().map(b => b.request.output.seed)).toEqual([100, 100]);
  expect(sent().every(b => b.request.output.variations === 1)).toBe(true);
  expect(sent()[0].files).toEqual(run.files!.references);
  expect(sent()[0].mask).toBeNull();
  expect(cells.map(c => c.label)).toEqual(['Turbo', 'Completo']);
});

it('Opção replaces only the chosen category, with the same seed', async () => {
  vi.mocked(api.createRun).mockResolvedValue({id: 'new'} as Run);
  await startComparison(run, {axis: 'option', category: 'pose', itemIds: ['pose-b', 'pose-c']}, items);
  expect(sent()).toHaveLength(2);
  expect(sent().map(b => b.request.attributes.pose)).toEqual([
    {intent: 'set', value: {kind: 'catalog', item_id: 'pose-b'}},
    {intent: 'set', value: {kind: 'catalog', item_id: 'pose-c'}},
  ]);
  for (const body of sent()) {
    expect(body.request.attributes.environment).toEqual(request.attributes.environment);
    expect(body.request.attributes.style).toEqual(request.attributes.style);
    expect(body.request.output.seed).toBe(100);
  }
});

it('a refused cell keeps its error and the others are still sent', async () => {
  vi.mocked(api.createRun)
    .mockResolvedValueOnce({id: 'ok-1'} as Run)
    .mockRejectedValueOnce(new Error('Falha 422 no pedido'))
    .mockResolvedValueOnce({id: 'ok-2'} as Run);
  const cells = await startComparison(run, {axis: 'profile'}, items);
  expect(sent()).toHaveLength(2);
  expect(cells).toEqual([{label: 'Turbo', runId: 'ok-1'}, {label: 'Completo', error: 'Falha 422 no pedido'}]);
});

it('a cell shows its image when its run completes', async () => {
  vi.mocked(api.run).mockImplementation(async (id: string) => ({
    id, status: 'completed', error: null,
    images: [{task_id: 't', position: 0, seed: 1, status: 'completed', files: [id === 'r-1' ? 'b'.repeat(64) : 'c'.repeat(64)]}],
  }) as unknown as Run);
  render(<CompareGrid cells={[{label: 'Turbo', runId: 'r-1'}, {label: 'Completo', runId: 'r-2'}, {label: 'Sentada', error: 'Falha 500'}]}
                      onClose={() => undefined} />);
  const image = await screen.findByRole('img', {name: 'Resultado: Turbo'});
  expect(image.getAttribute('src')).toBe(`/api/files/${'b'.repeat(64)}`);
  expect(await screen.findByRole('img', {name: 'Resultado: Completo'})).toBeTruthy();
  expect(screen.getByText('Falha 500')).toBeTruthy();
});
