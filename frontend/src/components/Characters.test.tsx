// @vitest-environment happy-dom
import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import {api} from '../api/client';
import type {SavedCharacter} from '../api/types';
import {Characters} from './Characters';

vi.mock('../api/client', () => ({api: {characters: vi.fn(), createCharacter: vi.fn(), updateCharacter: vi.fn(),
  deleteCharacter: vi.fn(), upload: vi.fn(), createRun: vi.fn(), run: vi.fn()}, fileUrl: (hash: string) => `/api/files/${hash}`}));
afterEach(() => {cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals();});

const ana: SavedCharacter = {id: 'c1', name: 'Ana', notes: 'Roupa de sempre', photos: ['a'.repeat(64)], created_at: 1, updated_at: 1};
const stored = (hash: string) => ({hash, mime: 'image/png', width: 10, height: 10});

// Folha de referência: each run is created as "r<n>" and finishes with the image "r<n>" repeated to 64 characters.
const FRENTE = 'Create an image. A full-body photograph of one person standing relaxed with the arms at the sides, facing the camera, front view, on a plain light gray studio background, with the same face, hairstyle, skin tone, body and clothing as the person in <image1>; use <image1> only for who the person is and what they wear, never for the pose, the place or the light. Even soft studio light, sharp focus, photorealistic.';
const imageOf = (id: string) => id.repeat(32);
function mockSheetRuns() {
  let count = 0;
  vi.mocked(api.createRun).mockImplementation(async () => ({id: `r${++count}`, status: 'created', images: []}) as never);
  vi.mocked(api.run).mockImplementation(async id => ({id, status: 'completed', images: [{files: [imageOf(id)]}]}) as never);
}

it('gera a folha com quatro gerações manuais a partir da foto principal', async () => {
  vi.mocked(api.characters).mockResolvedValue({characters: [ana]});
  mockSheetRuns();
  render(<Characters notify={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', {name: /Ana/}));
  fireEvent.click(screen.getByRole('button', {name: 'Gerar folha de referência'}));
  await waitFor(() => expect(api.createRun).toHaveBeenCalledTimes(4));
  const bodies = vi.mocked(api.createRun).mock.calls.map(([body]) => body);
  for (const body of bodies) {
    expect(body.request).toMatchObject({mode: 'generate', prompt_mode: 'manual', references: [{id: 'p', label: 'Ana'}],
      characters: [], output: {profile: 'turbo', aspect: '3:4', resolution: 1024, variations: 1}});
    expect(body.files).toEqual({p: 'a'.repeat(64)});
    expect(body.mask).toBeNull();
  }
  expect(bodies[0].request.manual_prompt).toBe(FRENTE);
  expect(bodies[1].request.manual_prompt).toContain('turned three-quarters to the side, head toward the camera');
  expect(bodies[2].request.manual_prompt).toContain('in side profile, facing left');
  expect(bodies[3].request.manual_prompt).toContain('head-and-shoulders portrait');
  expect(await screen.findByText('Confira o rosto antes de adicionar: só entram as vistas parecidas com a pessoa.')).toBeTruthy();
  for (const label of ['Frente', 'Três quartos', 'Perfil', 'Retrato']) expect(screen.getByText(label)).toBeTruthy();
});

it('adiciona a vista pronta à ficha e marca como adicionada', async () => {
  vi.mocked(api.characters).mockResolvedValue({characters: [ana]});
  mockSheetRuns();
  vi.mocked(api.updateCharacter).mockImplementation(async (_id, body) => ({...ana, photos: body.photos ?? []}));
  render(<Characters notify={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', {name: /Ana/}));
  fireEvent.click(screen.getByRole('button', {name: 'Gerar folha de referência'}));
  await waitFor(() => expect(screen.getAllByRole('button', {name: 'Adicionar à ficha'})).toHaveLength(4));
  fireEvent.click(screen.getAllByRole('button', {name: 'Adicionar à ficha'})[0]);
  await waitFor(() => expect(api.updateCharacter).toHaveBeenCalledWith('c1', {photos: ['a'.repeat(64), imageOf('r1')]}));
  expect(await screen.findByRole('button', {name: 'Adicionada'})).toBeTruthy();
});

it('desabilita adicionar com o motivo visível quando a ficha tem seis fotos', async () => {
  const full: SavedCharacter = {...ana, id: 'c2', name: 'Bia', photos: [0, 1, 2, 3, 4, 5].map(i => `${i}`.repeat(64))};
  vi.mocked(api.characters).mockResolvedValue({characters: [full]});
  mockSheetRuns();
  render(<Characters notify={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', {name: /Bia/}));
  fireEvent.click(screen.getByRole('button', {name: 'Gerar folha de referência'}));
  await waitFor(() => expect(screen.getAllByRole('button', {name: 'Adicionar à ficha'})).toHaveLength(4));
  for (const button of screen.getAllByRole('button', {name: 'Adicionar à ficha'})) expect((button as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getAllByText(/A ficha já tem 6 fotos/)).toHaveLength(4);
  expect(api.updateCharacter).not.toHaveBeenCalled();
});

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
