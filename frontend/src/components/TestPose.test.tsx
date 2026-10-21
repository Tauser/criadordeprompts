// @vitest-environment happy-dom
import {act, cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import {api} from '../api/client';
import type {Item} from '../api/types';
import {TestPose} from './TestPose';

vi.mock('../api/client', () => ({api: {testPose: vi.fn(), poseTest: vi.fn(), cancelPoseTest: vi.fn(async () => ({}))},
  poseTestUrl: (id: string) => `/api/library/pose-tests/${id}/image`}));
afterEach(() => {cleanup(); vi.clearAllMocks(); vi.useRealTimers();});

const hug: Item = {id: 'user.action.abc12345', category: 'action', label: '', prompt: 'standing side by side, hugging',
  edit_prompt: '', adult: false, enabled: true, requirements: {participants: 2}, provides: {}};

it('sends only the English text of the draft and shows the preview', async () => {
  vi.mocked(api.testPose).mockResolvedValue({id: 't1', status: 'completed', has_image: true});
  render(<TestPose item={hug} />);
  fireEvent.click(screen.getByRole('button', {name: 'Testar pose'}));
  const image = await screen.findByAltText('Prévia da pose');
  expect(image.getAttribute('src')).toBe('/api/library/pose-tests/t1/image');
  expect(api.testPose).toHaveBeenCalledWith(expect.objectContaining({prompt: hug.prompt, label: 'Teste',
    edit_prompt: null}), 'standard', []);
});

it('cancels the running test', async () => {
  vi.useFakeTimers();
  vi.mocked(api.testPose).mockResolvedValue({id: 't2', status: 'queued'});
  render(<TestPose item={hug} />);
  await act(async () => {fireEvent.click(screen.getByRole('button', {name: 'Testar pose'}));});
  fireEvent.click(screen.getByRole('button', {name: 'Cancelar'}));
  expect(api.cancelPoseTest).toHaveBeenCalledWith('t2');
  expect(screen.getByRole('button', {name: 'Testar pose'})).toBeTruthy();
  await act(async () => {vi.advanceTimersByTime(3000);});
  expect(api.poseTest).not.toHaveBeenCalled();
});

it('cancels the test when the editor closes the item', async () => {
  vi.mocked(api.testPose).mockResolvedValue({id: 't3', status: 'queued'});
  const view = render(<TestPose item={hug} />);
  await act(async () => {fireEvent.click(screen.getByRole('button', {name: 'Testar pose'}));});
  view.unmount();
  expect(api.cancelPoseTest).toHaveBeenCalledWith('t3');
});

it('an adult option needs adult content and the confirmation before testing', async () => {
  vi.mocked(api.testPose).mockResolvedValue({id: 't4', status: 'completed', has_image: true});
  render(<TestPose item={{...hug, adult: true}} />);
  const button = screen.getByRole('button', {name: 'Testar pose'}) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.click(screen.getByLabelText('Testar com conteúdo adulto (+18)'));
  expect(button.disabled).toBe(true);
  fireEvent.click(screen.getByLabelText('Confirmo que todas as pessoas retratadas são adultas.'));
  fireEvent.click(button);
  await waitFor(() => expect(api.testPose).toHaveBeenCalledWith(expect.anything(), 'adult', ['adults_only']));
});

it('shows the server error below the button', async () => {
  vi.mocked(api.testPose).mockRejectedValue(new Error('O ComfyUI não respondeu.'));
  render(<TestPose item={hug} />);
  fireEvent.click(screen.getByRole('button', {name: 'Testar pose'}));
  expect((await screen.findByRole('alert')).textContent).toBe('O ComfyUI não respondeu.');
});
