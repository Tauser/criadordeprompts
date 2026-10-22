// @vitest-environment happy-dom
import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import {api} from '../api/client';
import type {SavedCharacter} from '../api/types';
import {Characters} from './Characters';

vi.mock('../api/client', () => ({api: {characters: vi.fn(), createCharacter: vi.fn(), updateCharacter: vi.fn(),
  deleteCharacter: vi.fn(), upload: vi.fn()}, fileUrl: (hash: string) => `/api/files/${hash}`}));
afterEach(() => {cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals();});

const ana: SavedCharacter = {id: 'c1', name: 'Ana', notes: 'Roupa de sempre', photos: ['a'.repeat(64)], created_at: 1, updated_at: 1};
const stored = (hash: string) => ({hash, mime: 'image/png', width: 10, height: 10});

it('lists the saved characters with their main photo and notes', async () => {
  vi.mocked(api.characters).mockResolvedValue({characters: [ana]});
  render(<Characters notify={vi.fn()} />);
  expect(await screen.findByRole('button', {name: /Ana/})).toBeTruthy();
  expect(screen.getByText('Roupa de sempre')).toBeTruthy();
  expect(document.querySelector('img')?.getAttribute('src')).toBe(`/api/files/${'a'.repeat(64)}`);
});

it('creates a character from uploaded photos, with the chosen main photo first', async () => {
  vi.mocked(api.characters).mockResolvedValue({characters: []});
  vi.mocked(api.upload).mockResolvedValueOnce(stored('b'.repeat(64))).mockResolvedValueOnce(stored('c'.repeat(64)));
  vi.mocked(api.createCharacter).mockResolvedValue({...ana, id: 'c2', name: 'Bruno', notes: 'Camiseta'});
  const notify = vi.fn();
  render(<Characters notify={notify} />);
  fireEvent.click(await screen.findByRole('button', {name: 'Nova ficha'}));
  fireEvent.change(screen.getByLabelText('Nome'), {target: {value: 'Bruno'}});
  fireEvent.change(screen.getByLabelText('Notas'), {target: {value: 'Camiseta'}});
  const first = new File(['1'], 'frente.png', {type: 'image/png'});
  const second = new File(['2'], 'lado.png', {type: 'image/png'});
  fireEvent.change(screen.getByLabelText('Adicionar fotos'), {target: {files: [first, second]}});
  await waitFor(() => expect(screen.getByText('2 / 6')).toBeTruthy());
  fireEvent.click(screen.getAllByRole('button', {name: 'Tornar principal'})[0]);
  fireEvent.click(screen.getByRole('button', {name: 'Criar ficha'}));
  await waitFor(() => expect(api.createCharacter).toHaveBeenCalledWith({name: 'Bruno', notes: 'Camiseta',
    photos: ['c'.repeat(64), 'b'.repeat(64)]}));
  expect(notify).toHaveBeenCalledWith('Ficha “Bruno” salva.');
});

it('asks for a name and a photo before saving', async () => {
  vi.mocked(api.characters).mockResolvedValue({characters: []});
  render(<Characters notify={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', {name: 'Nova ficha'}));
  fireEvent.click(screen.getByRole('button', {name: 'Criar ficha'}));
  expect(screen.getByText('Dê um nome ao personagem.')).toBeTruthy();
  expect(screen.getByText('Adicione pelo menos uma foto.')).toBeTruthy();
  expect(api.createCharacter).not.toHaveBeenCalled();
});

it('warns under the notes when they describe the face or the hair, and stops when they do not', async () => {
  vi.mocked(api.characters).mockResolvedValue({characters: []});
  render(<Characters notify={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', {name: 'Nova ficha'}));
  const notes = screen.getByLabelText('Notas');
  fireEvent.change(notes, {target: {value: 'Cabelo loiro e olhos verdes'}});
  const warning = document.querySelector('.issue.warning');
  expect(warning?.textContent).toContain('cabelo, loiro, olhos');
  expect(warning?.textContent).toContain('ignorar a foto');
  fireEvent.change(notes, {target: {value: 'Roupa de sempre'}});
  expect(document.querySelector('.issue.warning')).toBeNull();
});

it('deletes a character only after confirmation', async () => {
  vi.mocked(api.characters).mockResolvedValue({characters: [ana]});
  vi.mocked(api.deleteCharacter).mockResolvedValue({deleted: 'c1'});
  vi.stubGlobal('confirm', () => true);
  render(<Characters notify={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', {name: /Ana/}));
  fireEvent.click(screen.getByRole('button', {name: 'Apagar'}));
  await waitFor(() => expect(api.deleteCharacter).toHaveBeenCalledWith('c1'));
  expect(await screen.findByText('Nenhuma ficha ainda. Crie uma para trazer a mesma pessoa para outros pedidos.')).toBeTruthy();
});
