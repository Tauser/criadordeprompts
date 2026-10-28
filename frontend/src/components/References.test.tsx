// @vitest-environment happy-dom
import {useState} from 'react';
import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import {api} from '../api/client';
import {addReference, applyReference, initialWorkspace, setSwap, type Workspace} from '../state/workspace';
import {Cast} from './Cast';
import {References} from './References';

vi.mock('../api/client', () => ({api: {upload: vi.fn(), characters: vi.fn(async () => ({characters: []}))},
  fileUrl: (hash: string) => `/api/files/${hash}`}));
afterEach(() => {cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks();});

it.each(['generate', 'edit'] as const)('adds uploaded photos in %s mode without randomUUID', async mode => {
  vi.stubGlobal('crypto', {getRandomValues: crypto.getRandomValues.bind(crypto)});
  vi.mocked(api.upload).mockResolvedValue({hash: 'a'.repeat(64), width: 64, height: 64, mime: 'image/png'});
  const notify = vi.fn();
  function Editor() {
    const [workspace, update] = useState(initialWorkspace(mode));
    return <References workspace={workspace} update={update} disabled={false} slots={{}} notify={notify} />;
  }
  render(<Editor />);
  const image = new File(['image'], 'foto.png', {type: 'image/png'});
  fireEvent.change(screen.getByLabelText(/Adicionar imagens/), {target: {files: [image]}});
  expect(await screen.findByRole('img', {name: 'foto.png'})).toBeTruthy();
  expect(screen.getByText('1 / 10')).toBeTruthy();
  if (mode === 'edit') expect(screen.getByText('Foto alvo')).toBeTruthy();
  await waitFor(() => expect(api.upload).toHaveBeenCalledWith(image, 'foto.png'));
  expect(notify).not.toHaveBeenCalled();
});

vi.mock('../lib/characters', async importOriginal => ({...await importOriginal<typeof import('../lib/characters')>(),
  imageSize: vi.fn(async () => ({width: 800, height: 1200}))}));

const namesOf = (ws: Workspace) => ['Pessoa 1', ...(ws.request.characters ?? []).map((_, i) => `Pessoa ${i + 2}`)];
function Form({start, issues = {}, notify = vi.fn()}: {start: Workspace; issues?: Record<string, string[]>;
  notify?: (m: string, e?: boolean) => void}) {
  const [workspace, update] = useState(start);
  return <>
    <References workspace={workspace} update={update} disabled={false} slots={{}} notify={notify} />
    <Cast workspace={workspace} names={namesOf(workspace)} automatic update={update} notify={notify} issues={issues} />
  </>;
}

it('uses a saved character: its main photo is another person in the scene, described by the notes', async () => {
  vi.mocked(api.characters).mockResolvedValue({characters: [{id: 'c1', name: 'Ana', notes: 'Roupa de sempre',
    photos: ['b'.repeat(64)], created_at: 1, updated_at: 1}]});
  const notify = vi.fn();
  render(<Form start={initialWorkspace('edit')} notify={notify} />);
  await waitFor(() => expect(screen.getByRole('option', {name: 'Ana'})).toBeTruthy());
  fireEvent.change(screen.getByLabelText('Usar personagem da ficha'), {target: {value: 'c1'}});
  expect(await screen.findByRole('img', {name: 'Ana'})).toBeTruthy();
  expect(screen.getByText('Personagem 2')).toBeTruthy();
  expect(screen.getByDisplayValue('Roupa de sempre')).toBeTruthy();
  expect(screen.queryByText('Foto alvo')).toBeNull();
  expect(notify).not.toHaveBeenCalled();
});

const photo = (name: string) => ({hash: name.padEnd(64, '0'), width: 10, height: 10, name});
const SWAP = 'Trocar a pessoa da foto por esta';
function withPhotos(mode: 'generate' | 'edit', ...names: string[]): Workspace {
  let ws = initialWorkspace(mode);
  for (const name of names) ws = addReference(ws, name, photo(name));
  return ws;
}
function Editor({start}: {start: Workspace}) {
  const [workspace, update] = useState(start);
  return <References workspace={workspace} update={update} disabled={false} slots={{}} notify={vi.fn()} />;
}

it('offers the swap only to a photo that is not the target, and then shows its mode', () => {
  render(<Editor start={withPhotos('edit', 'alvo', 'ana')} />);
  expect(screen.getAllByRole('option', {name: SWAP})).toHaveLength(1);
  fireEvent.change(screen.getByLabelText('Aplicar ana como'), {target: {value: '@swap'}});
  expect(screen.getByText('Entra no lugar')).toBeTruthy();
  expect(screen.getByLabelText('Quanto trocar com ana')).toBeTruthy();
  expect(screen.getByRole('option', {name: 'Corpo inteiro'})).toBeTruthy();
  expect(screen.getByRole('option', {name: 'Só o rosto'})).toBeTruthy();
  expect(screen.queryByRole('option', {name: SWAP})).toBeNull();
});

it('does not offer the swap in generate mode', () => {
  render(<Editor start={withPhotos('generate', 'ana')} />);
  expect(screen.queryByRole('option', {name: SWAP})).toBeNull();
});

it('disables the swap on other photos while one photo already holds it, with the reason on hover', () => {
  const ws = setSwap(withPhotos('edit', 'alvo', 'ana', 'bia'), 'ana', 'body');
  render(<Editor start={ws} />);
  const option = screen.getByRole('option', {name: SWAP}) as HTMLOptionElement;
  expect(option.disabled).toBe(true);
  expect(option.title).toContain('Outra imagem já troca a pessoa');
});

it('undoes the swap from the photo that holds it', () => {
  render(<Editor start={setSwap(withPhotos('edit', 'alvo', 'ana'), 'ana', 'head')} />);
  expect(screen.getByRole('option', {name: 'Só o rosto'})).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Aplicar ana como'), {target: {value: '@unswap'}});
  expect(screen.queryByText('Entra no lugar')).toBeNull();
  expect(screen.getByRole('option', {name: SWAP})).toBeTruthy();
});

it('rejects more than ten selected photos before uploading any of them', () => {
  const notify = vi.fn();
  render(<References workspace={initialWorkspace('generate')} update={vi.fn()} disabled={false}
    slots={{}} notify={notify} />);
  const images = Array.from({length: 11}, (_, i) => new File(['image'], `${i}.png`, {type: 'image/png'}));
  fireEvent.change(screen.getByLabelText(/Adicionar imagens/), {target: {files: images}});
  expect(api.upload).not.toHaveBeenCalled();
  expect(notify).toHaveBeenCalledWith('Use até dez imagens.', true);
});

it('shows the warnings about the cast under the character pick and under the position they ask for', async () => {
  vi.mocked(api.characters).mockResolvedValue({characters: [{id: 'c1', name: 'Ana', notes: '',
    photos: ['b'.repeat(64)], created_at: 1, updated_at: 1}]});
  const issues = {'characters': ['Prefira Criar.'], 'characters.0.position': ['Escolha a posição do personagem.']};
  render(<Form start={initialWorkspace('edit')} issues={issues} />);
  expect(screen.getByText('Prefira Criar.')).toBeTruthy();
  expect(screen.queryByText('Escolha a posição do personagem.')).toBeNull();
  await waitFor(() => expect(screen.getByRole('option', {name: 'Ana'})).toBeTruthy());
  fireEvent.change(screen.getByLabelText('Usar personagem da ficha'), {target: {value: 'c1'}});
  const position = await screen.findByLabelText('Posição do personagem 2');
  expect(position.parentElement?.textContent).toContain('Escolha a posição do personagem.');
});

it('in a new image, a ficha can be the main person, and its photo says so', async () => {
  vi.mocked(api.characters).mockResolvedValue({characters: [{id: 'c1', name: 'Ana', notes: 'Roupa de sempre',
    photos: ['b'.repeat(64)], created_at: 1, updated_at: 1}, {id: 'c2', name: 'Bia', notes: '',
    photos: ['c'.repeat(64)], created_at: 1, updated_at: 1}]});
  render(<Form start={initialWorkspace('generate')} />);
  await waitFor(() => expect(screen.getAllByRole('option', {name: 'Ana'})).toHaveLength(2));
  fireEvent.change(screen.getByLabelText('Personagem principal da ficha'), {target: {value: 'c1'}});
  expect(await screen.findByRole('img', {name: 'Ana'})).toBeTruthy();
  expect(screen.getByText('Personagem principal')).toBeTruthy();
  expect(screen.getByText('Rosto, corpo, pele e cabelo')).toBeTruthy();
  expect(screen.queryByText('Personagem 2')).toBeNull();
  fireEvent.change(screen.getByLabelText('Outro personagem da ficha'), {target: {value: 'c2'}});
  expect(await screen.findByText('Personagem 2')).toBeTruthy();
});

it('a photo applied as the main person is labelled so, and editing keeps one ficha picker', () => {
  render(<Editor start={applyReference(withPhotos('generate', 'ana'), 'ana', 'character')} />);
  expect(screen.getByText('Personagem principal')).toBeTruthy();
  cleanup();
  render(<Form start={withPhotos('edit', 'alvo')} />);
  expect(screen.queryByLabelText('Personagem principal da ficha')).toBeNull();
  expect(screen.getByLabelText('Usar personagem da ficha')).toBeTruthy();
});
