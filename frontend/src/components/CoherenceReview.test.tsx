// @vitest-environment happy-dom
import {act, cleanup, fireEvent, render, screen} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import {api} from '../api/client';
import type {Prepared} from '../api/types';
import {initialRequest} from '../state/workspace';
import {CoherenceReview} from './CoherenceReview';
import {PromptPreview} from './PromptPreview';

vi.mock('../api/client', () => ({api: {reviewCoherence: vi.fn(), coherence: vi.fn(), cancelCoherence: vi.fn(async () => ({}))}}));
afterEach(() => {cleanup(); vi.clearAllMocks(); vi.useRealTimers();});

const issue = {severity: 'error' as const, quote: 'seen from behind', problem: 'O corpo está de costas e o rosto de frente.',
  suggestion: 'Peça o olhar por cima do ombro.'};

it('shows the problems the model found and marks a review of an older prompt', async () => {
  vi.useFakeTimers();
  vi.mocked(api.reviewCoherence).mockResolvedValue({id: 'c1', status: 'queued', prompt: 'Create an image.'});
  vi.mocked(api.coherence).mockResolvedValue({id: 'c1', status: 'completed', result: {coherent: false, issues: [issue]}});
  const request = initialRequest('generate');
  const {rerender} = render(<CoherenceReview request={request} prompt="Create an image." ready />);
  fireEvent.click(screen.getByRole('button', {name: 'Analisar coerência com o modelo'}));
  await act(async () => {await vi.advanceTimersByTimeAsync(1600);});
  expect(api.reviewCoherence).toHaveBeenCalledWith(request);
  expect(screen.getByText(issue.problem)).toBeTruthy();
  expect(screen.getByText('Sugestão: ' + issue.suggestion)).toBeTruthy();
  expect(screen.queryByText(/O prompt mudou/)).toBeNull();
  rerender(<CoherenceReview request={request} prompt="Create an image. Changed." ready />);
  expect(screen.getByText(/O prompt mudou depois desta análise/)).toBeTruthy();
});

it('cancels the review when the panel goes away', async () => {
  vi.mocked(api.reviewCoherence).mockResolvedValue({id: 'c2', status: 'queued', prompt: 'x'});
  const {unmount} = render(<CoherenceReview request={initialRequest('generate')} prompt="x" ready />);
  fireEvent.click(screen.getByRole('button', {name: 'Analisar coerência com o modelo'}));
  await act(async () => {await Promise.resolve();});
  unmount();
  await act(async () => {await Promise.resolve(); await Promise.resolve();});
  expect(api.cancelCoherence).toHaveBeenCalledWith('c2');
});

it('summarises the rules as a single verdict', () => {
  const prepared = (valid: boolean, levels: string[]): Prepared => ({valid, status: 'compatible', slots: {}, prompt: 'x',
    segments: [], checks: [], issues: levels.map(level => ({code: level, level, kind: 'product', field: 'attributes', message: level})) as Prepared['issues']});
  const view = (p: Prepared) => render(<PromptPreview request={initialRequest('generate')} prepared={p} pending={false} error={null}
    onManual={() => undefined} onManualText={() => undefined} onFocusField={() => undefined} />);
  view(prepared(false, ['error', 'error', 'warning']));        // same message twice: one conflict, two fields
  expect(screen.getByText('Incoerente · 1 erro')).toBeTruthy();
  expect(screen.getAllByText('error')).toHaveLength(1);
  cleanup();
  view(prepared(true, ['warning', 'adjusted']));
  expect(screen.getByText('Apto · 1 aviso · 1 ajuste')).toBeTruthy();
  expect(screen.getByText('Ajustado')).toBeTruthy();
  cleanup();
  view(prepared(true, []));
  expect(screen.getByText('Apto para gerar')).toBeTruthy();
});
