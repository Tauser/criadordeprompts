// @vitest-environment happy-dom
import {cleanup, fireEvent, render, screen, within} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import type {StudioRequest} from '../api/types';
import {initialWorkspace} from '../state/workspace';
import {OutputCard} from './Studio';

afterEach(cleanup);

const generate = (): StudioRequest => initialWorkspace('generate').request;

it('"Ampliar no fim" sends the chosen factor and leaves it off by default', () => {
  const patch = vi.fn();
  render(<OutputCard request={generate()} patch={patch} />);
  const group = screen.getByRole('radiogroup', {name: 'Ampliar no fim'});
  expect(within(group).getByRole('radio', {name: 'Não'}).getAttribute('aria-checked')).toBe('true');
  fireEvent.click(within(group).getByRole('radio', {name: '1,5×'}));
  const next = generate();
  patch.mock.calls[0][0](next);
  expect(next.output.upscale).toBe(1.5);
  expect(screen.getByText('Ampliar no fim').getAttribute('title')).toContain('2,5 vezes mais rápido');
});

it('"Ampliar no fim" is disabled with a visible reason when the edit uses a mask', () => {
  const request = {...initialWorkspace('edit').request, mask: true, output: {...initialWorkspace('edit').request.output, upscale: 2 as const}};
  render(<OutputCard request={request} patch={vi.fn()} />);
  const group = screen.getByRole('radiogroup', {name: 'Ampliar no fim'});
  for (const option of within(group).getAllByRole('radio')) expect((option as HTMLButtonElement).disabled).toBe(true);
  expect(within(group).getByRole('radio', {name: 'Não'}).getAttribute('aria-checked')).toBe('true');
  expect(screen.getByText('Com máscara, a foto mantém o tamanho original.')).toBeTruthy();
});
