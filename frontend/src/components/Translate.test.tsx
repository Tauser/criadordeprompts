// @vitest-environment happy-dom
import {useState} from 'react';
import {act, cleanup, fireEvent, render, screen} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import {api} from '../api/client';
import {TranslateButton} from './Translate';

vi.mock('../api/client', () => ({api: {translate: vi.fn(), translation: vi.fn(), cancelTranslation: vi.fn(async () => ({}))}}));
afterEach(() => {cleanup(); vi.clearAllMocks(); vi.useRealTimers();});

it('replaces the field with the translation and can undo it', async () => {
  vi.useFakeTimers();
  vi.mocked(api.translate).mockResolvedValue({id: 'job-1', status: 'queued'});
  vi.mocked(api.translation).mockResolvedValue({id: 'job-1', status: 'completed', text: 'seated at a café table'});
  const onTranslated = vi.fn();
  function Field() {
    const [text, setText] = useState('sentada à mesa do café');
    return <>
      <input aria-label="Ação" value={text} onChange={e => setText(e.target.value)} />
      <TranslateButton label="a ação" text={text} onTranslated={value => {setText(value); onTranslated(value);}} />
    </>;
  }
  render(<Field />);
  fireEvent.click(screen.getByRole('button', {name: 'Traduzir a ação para inglês'}));
  await act(async () => {await vi.advanceTimersByTimeAsync(1600);});
  expect(api.translate).toHaveBeenCalledWith('sentada à mesa do café');
  expect(onTranslated).toHaveBeenLastCalledWith('seated at a café table');
  expect((screen.getByRole('textbox', {name: 'Ação'}) as HTMLInputElement).value).toBe('seated at a café table');
  fireEvent.click(screen.getByRole('button', {name: 'Desfazer tradução de a ação'}));
  expect(onTranslated).toHaveBeenLastCalledWith('sentada à mesa do café');
  expect((screen.getByRole('textbox', {name: 'Ação'}) as HTMLInputElement).value).toBe('sentada à mesa do café');
  fireEvent.click(screen.getByRole('button', {name: 'Traduzir a ação para inglês'}));
  await act(async () => {await vi.advanceTimersByTimeAsync(1600);});
  fireEvent.change(screen.getByRole('textbox', {name: 'Ação'}), {target: {value: 'uma ação diferente'}});
  expect(screen.queryByRole('button', {name: 'Desfazer tradução de a ação'})).toBeNull();
});

it('cancels the translation when the field goes away', async () => {
  vi.mocked(api.translate).mockResolvedValue({id: 'job-2', status: 'queued'});
  const {unmount} = render(<TranslateButton label="os detalhes" text="uma xícara azul" onTranslated={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', {name: 'Traduzir os detalhes para inglês'}));
  await act(async () => {await Promise.resolve();});
  unmount();
  await act(async () => {await Promise.resolve(); await Promise.resolve();});
  expect(api.cancelTranslation).toHaveBeenCalledWith('job-2');
});

it('never replaces the field with a runaway translation', async () => {
  vi.useFakeTimers();
  vi.mocked(api.translate).mockResolvedValue({id: 'job-3', status: 'queued'});
  vi.mocked(api.translation).mockResolvedValue({id: 'job-3', status: 'completed', text: 'a black dress, '.repeat(400)});
  const onTranslated = vi.fn();
  render(<TranslateButton label="a roupa" text="um vestido preto" onTranslated={onTranslated} />);
  fireEvent.click(screen.getByRole('button', {name: 'Traduzir a roupa para inglês'}));
  await act(async () => {await vi.advanceTimersByTimeAsync(1600);});
  expect(onTranslated).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toContain('longa demais');
});
