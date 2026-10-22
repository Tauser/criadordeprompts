// @vitest-environment happy-dom
import {act, cleanup, fireEvent, render, screen} from '@testing-library/react';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {api} from '../api/client';
import {MaskEditor} from './MaskEditor';

vi.mock('../api/client', () => ({
  api: {startTextMask: vi.fn(), textMask: vi.fn(), cancelTextMask: vi.fn(async () => ({}))},
  fileUrl: (hash: string) => `/api/files/${hash}`,
}));

const photo = 'a'.repeat(64);
const mask = 'b'.repeat(64);
const put = vi.fn();

// A 2x1 photo: the found mask has white in the first pixel only.
beforeEach(() => {
  const context = {
    clearRect: vi.fn(), drawImage: vi.fn(), putImageData: put,
    getImageData: vi.fn(() => ({data: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 255])})),
    createImageData: (w: number, h: number) => ({data: new Uint8ClampedArray(w * h * 4)}),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => context as never);
  vi.stubGlobal('Image', class {
    onload?: () => void;
    set src(_value: string) {queueMicrotask(() => this.onload?.());}
  });
});
afterEach(() => {cleanup(); vi.clearAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();});

function editor() {
  return render(<MaskEditor photo={photo} width={2} height={1} onSave={vi.fn()} onCancel={vi.fn()} />);
}

it('starts the selection with the text and loads the found mask into the editor', async () => {
  vi.useFakeTimers();
  vi.mocked(api.startTextMask).mockResolvedValue({id: 'j1', status: 'queued', mask: null, error: null});
  vi.mocked(api.textMask).mockResolvedValue({id: 'j1', status: 'completed', mask, error: null});
  editor();
  fireEvent.change(screen.getByRole('textbox', {name: /Selecionar por texto/}), {target: {value: '  the red shirt '}});
  await act(async () => {fireEvent.click(screen.getByRole('button', {name: 'Selecionar'}));});
  expect(api.startTextMask).toHaveBeenCalledWith(photo, 'the red shirt');
  expect(screen.getByText('Procurando…')).toBeTruthy();
  await act(async () => {await vi.advanceTimersByTimeAsync(1000);});
  expect(api.textMask).toHaveBeenCalledWith('j1');
  const painted = put.mock.calls.at(-1)![0] as ImageData;
  expect(painted.data[3]).toBe(255);     // the found pixel is painted
  expect(painted.data[7]).toBe(0);       // the rest stays unpainted
  expect(screen.queryByText('Procurando…')).toBeNull();
});

it('says nothing was found under the field when the mask is empty', async () => {
  vi.useFakeTimers();
  vi.mocked(api.startTextMask).mockResolvedValue({id: 'j2', status: 'queued', mask: null, error: null});
  vi.mocked(api.textMask).mockResolvedValue({id: 'j2', status: 'completed', mask: null, empty: true, error: null});
  editor();
  fireEvent.change(screen.getByRole('textbox', {name: /Selecionar por texto/}), {target: {value: 'a purple unicorn'}});
  await act(async () => {fireEvent.click(screen.getByRole('button', {name: 'Selecionar'}));});
  await act(async () => {await vi.advanceTimersByTimeAsync(1000);});
  expect(screen.getByText('Nada encontrado com esse texto.')).toBeTruthy();
  expect(put).not.toHaveBeenCalled();
});

it('shows the server error and does not start without text', async () => {
  vi.mocked(api.startTextMask).mockRejectedValue(new Error('O SAM 3 não está disponível no ComfyUI.'));
  editor();
  const button = screen.getByRole('button', {name: 'Selecionar'}) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.change(screen.getByRole('textbox', {name: /Selecionar por texto/}), {target: {value: 'the hat'}});
  await act(async () => {fireEvent.click(screen.getByRole('button', {name: 'Selecionar'}));});
  expect(screen.getByRole('alert').textContent).toContain('O SAM 3 não está disponível no ComfyUI.');
});

it('stops a running selection on the server', async () => {
  vi.useFakeTimers();
  vi.mocked(api.startTextMask).mockResolvedValue({id: 'j3', status: 'queued', mask: null, error: null});
  vi.mocked(api.textMask).mockResolvedValue({id: 'j3', status: 'running', mask: null, error: null});
  editor();
  fireEvent.change(screen.getByRole('textbox', {name: /Selecionar por texto/}), {target: {value: 'the dog'}});
  await act(async () => {fireEvent.click(screen.getByRole('button', {name: 'Selecionar'}));});
  fireEvent.click(screen.getByRole('button', {name: 'Parar'}));
  expect(api.cancelTextMask).toHaveBeenCalledWith('j3');
  expect(screen.getByRole('button', {name: 'Selecionar'})).toBeTruthy();
});
