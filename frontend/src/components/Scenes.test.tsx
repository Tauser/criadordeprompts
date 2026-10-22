// @vitest-environment happy-dom
import {act, cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {ApiError, api} from '../api/client';
import type {Prepared, Run, SavedCharacter, SavedRequest} from '../api/types';
import {EDIT_PRESET_WARNING, STORY_KEY, type Story} from '../lib/scenes';
import {initialRequest} from '../state/workspace';
import {Scenes} from './Scenes';

vi.mock('../api/client', () => {
  class ApiError extends Error {
    constructor(public status: number, public body: {error?: string; issues?: unknown[]}) {
      super(body.error || `Falha ${status}`);
    }
  }
  return {
    ApiError,
    fileUrl: (hash: string) => `/api/files/${hash}`,
    api: {presets: vi.fn(), characters: vi.fn(), prepare: vi.fn(), createRun: vi.fn(), run: vi.fn()},
  };
});
vi.mock('../lib/characters', () => ({imageSize: vi.fn(async () => ({width: 800, height: 1000}))}));

const generate: SavedRequest = {id: 'p-rua', name: 'Rua à noite', created_at: 1, updated_at: 1, request: initialRequest('generate')};
const edit: SavedRequest = {id: 'p-edit', name: 'Trocar roupa', created_at: 1, updated_at: 1, request: initialRequest('edit')};
const ana: SavedCharacter = {id: 'f-ana', name: 'Ana', notes: '', photos: ['a'.repeat(64)], created_at: 1, updated_at: 1};
const bruno: SavedCharacter = {id: 'f-bruno', name: 'Bruno', notes: 'holding an umbrella', photos: ['b'.repeat(64)], created_at: 1, updated_at: 1};

// Scene 1: generate, Ana. Scene 2: edit (skipped). Scene 3: generate, Bruno in front.
const story: Story = {title: 'Teste', scenes: [
  {id: 's1', preset: 'p-rua', main: 'f-ana', people: [], note: ''},
  {id: 's2', preset: 'p-edit', main: null, people: [], note: ''},
  {id: 's3', preset: 'p-rua', main: null, people: [{character: 'f-bruno', position: 'front'}], note: 'Ela sorri.'},
]};

const validPrepared = {valid: true, status: 'compatible', issues: [], slots: {}, prompt: 'Create an image.', segments: [], checks: []} as Prepared;
let runNumber = 0;

const notify = vi.fn();
const onOpenRun = vi.fn();

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(STORY_KEY, JSON.stringify(story));
  runNumber = 0;
  notify.mockReset();
  onOpenRun.mockReset();
  vi.mocked(api.presets).mockResolvedValue({presets: [generate, edit]});
  vi.mocked(api.characters).mockResolvedValue({characters: [ana, bruno]});
  vi.mocked(api.prepare).mockReset().mockResolvedValue(validPrepared);
  vi.mocked(api.createRun).mockReset().mockImplementation(async () => ({id: `run-${++runNumber}`}) as Run);
  vi.mocked(api.run).mockReset().mockResolvedValue({id: 'x', status: 'generating', images: [], error: null} as unknown as Run);
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

it('Gerar todas sends one run per scene with a new request, skips the edit scene and shows its warning', async () => {
  render(<Scenes notify={notify} onOpenRun={onOpenRun} />);
  const button = await screen.findByRole('button', {name: 'Gerar todas (2 cenas)'});
  expect(screen.getByText(EDIT_PRESET_WARNING)).toBeTruthy();

  await act(async () => {fireEvent.click(button);});
  await waitFor(() => expect(api.createRun).toHaveBeenCalledTimes(2));

  const [first, second] = vi.mocked(api.createRun).mock.calls.map(([body]) => body);
  expect(first.request.references.map(r => r.label)).toEqual(['Ana']);
  expect(Object.values(first.files)).toEqual(['a'.repeat(64)]);
  expect(first.mask).toBeNull();
  expect(second.request.characters).toEqual([expect.objectContaining({position: 'front', description: 'holding an umbrella'})]);
  expect(second.request.details).toBe('Ela sorri.');
  expect(api.prepare).toHaveBeenCalledTimes(2);
  expect(notify).toHaveBeenCalledWith('2 de 2 cenas enviadas.', false);
  await waitFor(() => expect(screen.getAllByRole('button', {name: 'Abrir no Studio'})).toHaveLength(2));
});

it('a scene that fails does not stop the others and shows its issues on its own row', async () => {
  vi.mocked(api.prepare).mockRejectedValueOnce(new ApiError(422, {error: 'Há campos inválidos.', issues: [
    {code: 'contract', level: 'error', kind: 'product', field: 'attributes.pose', message: 'Pose: o texto não pode ficar vazio.'},
  ]}));
  render(<Scenes notify={notify} onOpenRun={onOpenRun} />);
  const button = await screen.findByRole('button', {name: 'Gerar todas (2 cenas)'});
  await act(async () => {fireEvent.click(button);});

  await waitFor(() => expect(api.createRun).toHaveBeenCalledTimes(1));
  expect(screen.getByText('Há campos inválidos.')).toBeTruthy();
  expect(screen.getByText('Pose: o texto não pode ficar vazio.')).toBeTruthy();
  expect(vi.mocked(api.createRun).mock.calls[0][0].request.characters).toEqual([expect.objectContaining({position: 'front'})]);
  expect(notify).toHaveBeenCalledWith('1 de 2 cenas enviadas.', true);
});

it('Abrir no Studio hands the scene run to the Studio', async () => {
  render(<Scenes notify={notify} onOpenRun={onOpenRun} />);
  const button = await screen.findByRole('button', {name: 'Gerar todas (2 cenas)'});
  await act(async () => {fireEvent.click(button);});
  const open = await screen.findAllByRole('button', {name: 'Abrir no Studio'});
  fireEvent.click(open[1]);
  expect(onOpenRun).toHaveBeenCalledWith('run-2');
});

it('a new scene is added and saved with the story', async () => {
  render(<Scenes notify={notify} onOpenRun={onOpenRun} />);
  await screen.findByRole('button', {name: 'Gerar todas (2 cenas)'});
  fireEvent.click(screen.getByRole('button', {name: 'Adicionar cena'}));
  expect(screen.getByRole('heading', {name: 'Cena 4'})).toBeTruthy();
  expect(JSON.parse(localStorage.getItem(STORY_KEY)!).scenes).toHaveLength(4);
});
