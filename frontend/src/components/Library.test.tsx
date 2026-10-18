// @vitest-environment happy-dom
import {act, cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import {api} from '../api/client';
import type {LibrarySnapshot} from '../api/types';
import {Library} from './Library';

vi.mock('../api/client', () => ({api: {saveLibrary: vi.fn(), translate: vi.fn(), translation: vi.fn(),
  cancelTranslation: vi.fn(async () => ({}))}}));
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
