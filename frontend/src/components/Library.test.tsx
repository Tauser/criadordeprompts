// @vitest-environment happy-dom
import {act, cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import {api} from '../api/client';
import type {Item, LibrarySnapshot} from '../api/types';
import {Library} from './Library';

vi.mock('../api/client', () => ({api: {saveLibrary: vi.fn(), translate: vi.fn(), translation: vi.fn(),
  cancelTranslation: vi.fn(async () => ({})), auditItem: vi.fn(async () => ({findings: []})), auditLibrary: vi.fn(), upload: vi.fn()},
  fileUrl: (hash: string) => `/api/files/${hash}`}));
afterEach(() => {cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals();});

const twoItems: LibrarySnapshot = {revision: 1, origins: {'environment.a': 'builtin', 'environment.b': 'builtin'},
  items: ['a', 'b'].map(id => ({id: `environment.${id}`, category: 'environment', label: id === 'a' ? 'Jardim' : 'Praia',
    prompt: id, adult: false, enabled: true,
    requirements: {}, provides: {}}))};

it('does not mark a newly opened item dirty when saving the previous item finishes', async () => {
  vi.stubGlobal('confirm', () => true);
  let resolve!: (snapshot: LibrarySnapshot) => void;
  vi.mocked(api.saveLibrary).mockReturnValue(new Promise(done => {resolve = done;}));
  const setDirty = vi.fn();
  render(<Library snapshot={twoItems} onSaved={vi.fn()} notify={vi.fn()} setDirty={setDirty} />);
  fireEvent.click(screen.getByRole('button', {name: /Jardim/}));
  fireEvent.change(screen.getByLabelText('Nome'), {target: {value: 'Jardim novo'}});
  fireEvent.click(screen.getByRole('button', {name: 'Salvar'}));
  fireEvent.click(screen.getByRole('button', {name: /Praia/}));
  await act(async () => resolve(twoItems));
  expect((screen.getByLabelText('Nome') as HTMLInputElement).value).toBe('Praia');
  expect(setDirty).toHaveBeenLastCalledWith(false);
});

it('reviews the whole library grouped by level and opens a flagged option in the editor', async () => {
  const snapshot: LibrarySnapshot = {...twoItems, items: [...twoItems.items, {...twoItems.items[0], id: 'environment.c', label: 'Rio'}],
    origins: {...twoItems.origins, 'environment.c': 'builtin'}};
  vi.mocked(api.auditLibrary).mockResolvedValue({
    'environment.a': [{code: 'x_conflict', level: 'conflict', message: 'Texto contradiz o apoio.'},
                      {code: 'x_style', level: 'style', message: 'Falta a descrição em português.'}],
    'environment.c': [{code: 'y_amb', level: 'ambiguity', message: 'Pode ser lido de dois jeitos.'}],
  });
  render(<Library snapshot={snapshot} onSaved={vi.fn()} notify={vi.fn()} setDirty={vi.fn()} />);
  fireEvent.click(screen.getByLabelText(/Revisar biblioteca/));
  const conflict = await screen.findByRole('region', {name: 'Conflito'});
  expect(conflict.textContent).toContain('Jardim');
  expect(conflict.textContent).toContain('Texto contradiz o apoio.');
  expect(conflict.textContent).not.toContain('Falta a descrição');
  expect(screen.getByRole('region', {name: 'Ambíguo'}).textContent).toContain('Rio');
  expect(screen.getByRole('region', {name: 'Redação'}).textContent).toContain('Falta a descrição em português.');
  expect(screen.queryByText('Praia')).toBeNull();
  expect(screen.getByLabelText(/Revisar biblioteca \(2\)/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', {name: /Rio/}));
  expect((screen.getByLabelText('Nome') as HTMLInputElement).value).toBe('Rio');
  expect(api.saveLibrary).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText(/Revisar biblioteca/));
  expect(screen.getByRole('button', {name: /Praia/})).toBeTruthy();
});

it('saves the complete edit instruction separately from the generation description', async () => {
  const snapshot: LibrarySnapshot = {revision: 2, origins: {'wardrobe.coat': 'builtin'}, items: [{
    id: 'wardrobe.coat', category: 'wardrobe', label: 'Casaco', prompt: 'a dark coat', adult: false,
    enabled: true, requirements: {}, provides: {},
  }]};
  vi.mocked(api.saveLibrary).mockResolvedValue(snapshot);
  render(<Library snapshot={snapshot} onSaved={vi.fn()} notify={vi.fn()} setDirty={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', {name: /Casaco/}));
  fireEvent.change(screen.getByLabelText('Instrução completa para edição (opcional, em inglês)'),
    {target: {value: '  Replace the jacket with a dark coat.  '}});
  fireEvent.click(screen.getByRole('button', {name: 'Salvar'}));
  await waitFor(() => expect(api.saveLibrary).toHaveBeenCalledWith(2, [expect.objectContaining({
    prompt: 'a dark coat', edit_prompt: 'Replace the jacket with a dark coat.',
  })]));
});

it('removes several of your own options at once and leaves built-in ones alone', async () => {
  vi.stubGlobal('confirm', () => true);
  const snapshot: LibrarySnapshot = {revision: 3,
    origins: {'environment.mine1': 'user', 'environment.mine2': 'user', 'environment.base': 'builtin'},
    items: [['mine1', 'Meu bar'], ['mine2', 'Meu quarto'], ['base', 'Praia']].map(([id, label]) => ({
      id: `environment.${id}`, category: 'environment', label, prompt: id, adult: false, enabled: true,
      requirements: {}, provides: {}}))};
  vi.mocked(api.saveLibrary).mockResolvedValue({...snapshot, items: [snapshot.items[2]],
    origins: {'environment.base': 'builtin'}, revision: 4});
  render(<Library snapshot={snapshot} onSaved={vi.fn()} notify={vi.fn()} setDirty={vi.fn()} />);
  fireEvent.click(screen.getByLabelText(/Selecionar todas as 3 visíveis/));
  fireEvent.click(screen.getByRole('button', {name: 'Remover'}));
  await waitFor(() => expect(api.saveLibrary).toHaveBeenCalledWith(3, []));
});

it('shows only your own options when asked', () => {
  const snapshot: LibrarySnapshot = {revision: 3,
    origins: {'environment.mine': 'user', 'environment.edited': 'custom', 'environment.base': 'builtin'},
    items: [['mine', 'Meu bar'], ['edited', 'Praia editada'], ['base', 'Praia']].map(([id, label]) => ({
      id: `environment.${id}`, category: 'environment', label, prompt: id, adult: false, enabled: true,
      requirements: {}, provides: {}}))};
  render(<Library snapshot={snapshot} onSaved={vi.fn()} notify={vi.fn()} setDirty={vi.fn()} />);
  fireEvent.click(screen.getByLabelText(/Só as minhas \(2\)/));
  expect(screen.queryByLabelText('Selecionar Meu bar')).not.toBeNull();
  expect(screen.queryByLabelText('Selecionar Praia editada')).not.toBeNull();
  expect(screen.queryByLabelText('Selecionar Praia')).toBeNull();
});

it('deactivates selected built-in options instead of deleting them', async () => {
  vi.mocked(api.saveLibrary).mockResolvedValue(twoItems);
  render(<Library snapshot={twoItems} onSaved={vi.fn()} notify={vi.fn()} setDirty={vi.fn()} />);
  fireEvent.click(screen.getByLabelText('Selecionar Praia'));
  fireEvent.click(screen.getByRole('button', {name: 'Desativar'}));
  await waitFor(() => expect(api.saveLibrary).toHaveBeenCalledWith(1, [
    expect.objectContaining({id: 'environment.b', enabled: false})]));
});

it('says where a saved +18 option shows up', async () => {
  const snapshot: LibrarySnapshot = {revision: 6, origins: {'pose.x': 'builtin'}, items: [{id: 'pose.x', category: 'pose',
    label: 'Deitado', prompt: 'lying on the back', adult: true, enabled: true, requirements: {}, provides: {}}]};
  vi.mocked(api.saveLibrary).mockResolvedValue(snapshot);
  const notify = vi.fn();
  render(<Library snapshot={snapshot} onSaved={vi.fn()} notify={notify} setDirty={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', {name: /Deitado/}));
  fireEvent.change(screen.getByLabelText('Nome'), {target: {value: 'Deitado de costas'}});
  fireEvent.click(screen.getByRole('button', {name: 'Salvar'}));
  await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.stringMatching(/só aparece com "Mostrar opções adultas/)));
});

it('moves your own option to another category and drops what the new one does not use', async () => {
  vi.mocked(api.saveLibrary).mockImplementation(async (_revision: number, items: unknown[]) =>
    ({revision: 5, origins: {'user.environment.x': 'user'}, items: items as Item[]}));
  const snapshot: LibrarySnapshot = {revision: 4, origins: {'user.environment.x': 'user', 'environment.b': 'builtin'},
    items: [{id: 'user.environment.x', category: 'pose', label: 'Reclinar', prompt: 'reclining on a bed', adult: false,
      enabled: true, requirements: {participants: 1, posture: 'lying', gaze: 'camera'}, provides: {}},
    {id: 'environment.b', category: 'environment', label: 'Praia', prompt: 'b', adult: false, enabled: true,
      requirements: {}, provides: {supports: ['floor']}}]};
  render(<Library snapshot={snapshot} onSaved={vi.fn()} notify={vi.fn()} setDirty={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', {name: /Reclinar/}));
  const category = screen.getByRole('combobox', {name: 'Categoria'}) as HTMLSelectElement;
  expect(category.disabled).toBe(false);
  fireEvent.change(category, {target: {value: 'expression'}});
  expect(screen.getByText(/número de pessoas, postura: esses ajustes saem ao salvar/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', {name: 'Salvar'}));
  await waitFor(() => expect(api.saveLibrary).toHaveBeenCalled());
  const saved = (vi.mocked(api.saveLibrary).mock.calls[0][1] as Item[]).find(i => i.id === 'user.environment.x')!;
  expect(saved.category).toBe('expression');
  expect(saved.requirements).toEqual({gaze: 'camera'});
});

it('keeps the category of the Studio options locked', () => {
  render(<Library snapshot={twoItems} onSaved={vi.fn()} notify={vi.fn()} setDirty={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', {name: /Jardim/}));
  expect((screen.getByRole('combobox', {name: 'Categoria'}) as HTMLSelectElement).disabled).toBe(true);
});
