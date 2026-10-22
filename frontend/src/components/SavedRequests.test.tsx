// @vitest-environment happy-dom
import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import {api} from '../api/client';
import type {SavedRequest, StudioRequest} from '../api/types';
import {initialWorkspace} from '../state/workspace';
import {SavedRequests} from './SavedRequests';

vi.mock('../api/client', () => ({api: {presets: vi.fn(), createPreset: vi.fn(), renamePreset: vi.fn(), deletePreset: vi.fn()}}));
afterEach(() => {cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals();});

const choices = (): StudioRequest => ({
  ...initialWorkspace('edit').request, details: 'noite na rua',
  attributes: {environment: {intent: 'set', value: {kind: 'catalog', item_id: 'environment.garden'}}},
});
const saved = (id: string, name: string, request = choices()): SavedRequest =>
  ({id, name, request, created_at: 1, updated_at: 1});

it('saving sends the current request under the typed name', async () => {
  vi.mocked(api.presets).mockResolvedValue({presets: []});
  const current = choices();
  vi.mocked(api.createPreset).mockResolvedValue(saved('p1', 'Cena noturna na rua, 2 pessoas', current));
  const notify = vi.fn();
  render(<SavedRequests current={() => current} onLoad={() => undefined} notify={notify} />);
  await screen.findByText('Nenhum pedido salvo');

  fireEvent.click(screen.getByRole('button', {name: 'Salvar pedido'}));
  fireEvent.change(screen.getByRole('textbox', {name: 'Nome do pedido'}), {target: {value: '  Cena noturna na rua, 2 pessoas  '}});
  fireEvent.click(screen.getByRole('button', {name: 'Salvar'}));

  await waitFor(() => expect(api.createPreset).toHaveBeenCalledWith('Cena noturna na rua, 2 pessoas', current));
  expect(await screen.findByRole('option', {name: 'Cena noturna na rua, 2 pessoas'})).toBeTruthy();
  expect(notify).toHaveBeenCalledWith('Pedido “Cena noturna na rua, 2 pessoas” salvo.');
});

it('an empty name is explained below the field and nothing is sent', async () => {
  vi.mocked(api.presets).mockResolvedValue({presets: []});
  render(<SavedRequests current={choices} onLoad={() => undefined} notify={() => undefined} />);
  await screen.findByText('Nenhum pedido salvo');

  fireEvent.click(screen.getByRole('button', {name: 'Salvar pedido'}));
  fireEvent.change(screen.getByRole('textbox', {name: 'Nome do pedido'}), {target: {value: '   '}});
  fireEvent.click(screen.getByRole('button', {name: 'Salvar'}));

  expect(await screen.findByText('Dê um nome ao pedido.')).toBeTruthy();
  expect(api.createPreset).not.toHaveBeenCalled();
});

it('loading hands the saved choices to the form', async () => {
  const preset = saved('p1', 'Cena noturna');
  vi.mocked(api.presets).mockResolvedValue({presets: [preset]});
  const onLoad = vi.fn();
  render(<SavedRequests current={choices} onLoad={onLoad} notify={() => undefined} />);

  const select = await screen.findByRole('combobox', {name: 'Pedido salvo'});
  fireEvent.change(select, {target: {value: 'p1'}});
  fireEvent.click(screen.getByRole('button', {name: 'Carregar'}));

  expect(onLoad).toHaveBeenCalledWith(preset.request);
  expect(onLoad.mock.calls[0][0].attributes.environment).toEqual({intent: 'set', value: {kind: 'catalog', item_id: 'environment.garden'}});
});

it('deleting asks for confirmation first', async () => {
  vi.mocked(api.presets).mockResolvedValue({presets: [saved('p1', 'Cena noturna')]});
  vi.mocked(api.deletePreset).mockResolvedValue({deleted: 'p1'});
  const confirm = vi.fn(() => false);
  vi.stubGlobal('confirm', confirm);
  render(<SavedRequests current={choices} onLoad={() => undefined} notify={() => undefined} />);

  fireEvent.change(await screen.findByRole('combobox', {name: 'Pedido salvo'}), {target: {value: 'p1'}});
  fireEvent.click(screen.getByRole('button', {name: 'Apagar'}));
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(api.deletePreset).not.toHaveBeenCalled();

  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', {name: 'Apagar'}));
  await waitFor(() => expect(api.deletePreset).toHaveBeenCalledWith('p1'));
});
