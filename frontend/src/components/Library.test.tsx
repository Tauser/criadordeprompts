// @vitest-environment happy-dom
import {act, cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import {api} from '../api/client';
import type {LibrarySnapshot} from '../api/types';
import {Library} from './Library';

vi.mock('../api/client', () => ({api: {saveLibrary: vi.fn(), translate: vi.fn(), translation: vi.fn(),
  cancelTranslation: vi.fn(async () => ({})), auditItem: vi.fn(async () => ({findings: []})), upload: vi.fn(),
  describeReference: vi.fn(), referenceDescription: vi.fn(), cancelReferenceDescription: vi.fn(async () => ({}))},
  fileUrl: (hash: string) => `/api/files/${hash}`}));
afterEach(() => {cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals();});

const twoItems: LibrarySnapshot = {revision: 1, origins: {'environment.a': 'builtin', 'environment.b': 'builtin'},
  items: ['a', 'b'].map(id => ({id: `environment.${id}`, category: 'environment', label: id === 'a' ? 'Jardim' : 'Praia',
    prompt: id, prompt_pt: id === 'a' ? 'um jardim' : 'uma praia', adult: false, enabled: true,
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

it('cancels a translation whose creation answer arrives after switching items', async () => {
  let resolve!: (job: {id: string; status: string}) => void;
  vi.mocked(api.translate).mockReturnValue(new Promise(done => {resolve = done;}));
  render(<Library snapshot={twoItems} onSaved={vi.fn()} notify={vi.fn()} setDirty={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', {name: /Jardim/}));
  fireEvent.click(screen.getByRole('button', {name: 'Traduzir para inglês'}));
  fireEvent.click(screen.getByRole('button', {name: /Praia/}));
  await act(async () => resolve({id: 'old-translation', status: 'queued'}));
  expect(api.cancelTranslation).toHaveBeenCalledWith('old-translation');
  expect(api.translation).not.toHaveBeenCalled();
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

it('deactivates selected built-in options instead of deleting them', async () => {
  vi.mocked(api.saveLibrary).mockResolvedValue(twoItems);
  render(<Library snapshot={twoItems} onSaved={vi.fn()} notify={vi.fn()} setDirty={vi.fn()} />);
  fireEvent.click(screen.getByLabelText('Selecionar Praia'));
  fireEvent.click(screen.getByRole('button', {name: 'Desativar'}));
  await waitFor(() => expect(api.saveLibrary).toHaveBeenCalledWith(1, [
    expect.objectContaining({id: 'environment.b', enabled: false})]));
});

const photoDraft = {category: 'action' as const, label: 'Abraço de lado (dois adultos)',
  prompt: 'two adults standing side by side, the adult on the left wrapping the right arm around the waist of the adult on the right',
  edit_prompt: 'Change the pose of the two adults so they stand side by side in a hug.',
  prompt_pt: 'dois adultos em pé lado a lado, abraçados pela cintura', adult: false,
  requirements: {participants: 2, posture: 'standing' as const, gaze: 'any' as const, orientation: 'front' as const,
    support_any_of: [], minimum_framing: 'half' as const}};

it('fills a new action from a reference photo without saving it', async () => {
  vi.mocked(api.upload).mockResolvedValue({hash: 'photo1', mime: 'image/png', width: 640, height: 480});
  vi.mocked(api.describeReference).mockResolvedValue({id: 'd1', status: 'completed', draft: photoDraft, findings: []});
  const notify = vi.fn();
  render(<Library snapshot={twoItems} onSaved={vi.fn()} notify={notify} setDirty={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', {name: 'Nova opção'}));
  expect(screen.queryByRole('group', {name: 'Descrever a partir da foto'})).toBeNull();     // only poses and actions
  fireEvent.change(screen.getByRole('combobox', {name: 'Categoria'}), {target: {value: 'action'}});
  const describe = screen.getByRole('button', {name: 'Descrever a partir da foto'});
  expect((describe as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Escolher foto de referência'),
    {target: {files: [new File(['x'], 'ref.png', {type: 'image/png'})]}});
  await waitFor(() => expect((describe as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(describe);
  await waitFor(() => expect((screen.getByLabelText('Nome') as HTMLInputElement).value).toBe(photoDraft.label));
  expect(api.describeReference).toHaveBeenCalledWith('photo1', 'action');
  expect((screen.getByLabelText('Descrição em inglês (é o texto enviado ao modelo)') as HTMLTextAreaElement).value)
    .toBe(photoDraft.prompt);
  expect((screen.getByLabelText('Pessoas') as HTMLInputElement).value).toBe('2');
  expect(screen.getByText('Alterações não salvas')).toBeTruthy();
  expect(api.saveLibrary).not.toHaveBeenCalled();
  expect(notify).toHaveBeenCalledWith('Rascunho preenchido a partir da foto. Revise e salve.');
});

it('cancels a description when another item is opened, and offers none for existing options', async () => {
  vi.stubGlobal('confirm', () => true);
  vi.mocked(api.upload).mockResolvedValue({hash: 'photo2', mime: 'image/png', width: 64, height: 64});
  vi.mocked(api.describeReference).mockResolvedValue({id: 'd2', status: 'running'});
  vi.mocked(api.referenceDescription).mockReturnValue(new Promise(() => undefined));
  render(<Library snapshot={twoItems} onSaved={vi.fn()} notify={vi.fn()} setDirty={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', {name: 'Nova opção'}));
  fireEvent.change(screen.getByRole('combobox', {name: 'Categoria'}), {target: {value: 'pose'}});
  fireEvent.change(screen.getByLabelText('Escolher foto de referência'),
    {target: {files: [new File(['x'], 'ref.png', {type: 'image/png'})]}});
  const describe = screen.getByRole('button', {name: 'Descrever a partir da foto'});
  await waitFor(() => expect((describe as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(describe);
  await screen.findByText('Descrevendo no modelo local…');
  fireEvent.click(screen.getByRole('button', {name: /Jardim/}));
  expect(api.cancelReferenceDescription).toHaveBeenCalledWith('d2');
  expect(screen.queryByRole('group', {name: 'Descrever a partir da foto'})).toBeNull();
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
