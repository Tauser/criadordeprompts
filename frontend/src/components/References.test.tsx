// @vitest-environment happy-dom
import {useState} from 'react';
import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import {api} from '../api/client';
import {initialWorkspace} from '../state/workspace';
import {References} from './References';

vi.mock('../api/client', () => ({api: {upload: vi.fn()}, fileUrl: (hash: string) => `/api/files/${hash}`}));
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

it('rejects more than ten selected photos before uploading any of them', () => {
  const notify = vi.fn();
  render(<References workspace={initialWorkspace('generate')} update={vi.fn()} disabled={false}
    slots={{}} notify={notify} />);
  const images = Array.from({length: 11}, (_, i) => new File(['image'], `${i}.png`, {type: 'image/png'}));
  fireEvent.change(screen.getByLabelText(/Adicionar imagens/), {target: {files: images}});
  expect(api.upload).not.toHaveBeenCalled();
  expect(notify).toHaveBeenCalledWith('Use até dez imagens.', true);
});
