// @vitest-environment happy-dom
import {cleanup, fireEvent, render, screen} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import type {Run} from '../api/types';
import {RunPanel} from './RunPanel';

afterEach(cleanup);

const image = (position: number, seed: number) => ({task_id: `t${position}`, position, seed, status: 'completed',
  files: [String(position).padEnd(64, '0')]});
const run = (profile: string): Run => ({id: 'r1', request_id: 'x', status: 'completed', mode: 'generate', prompt: 'p',
  effective_prompt: 'p', refined_prompt: null, error: null, cancel_requested: false, best_task_id: 't1',
  created_at: 1, updated_at: 2,
  settings: {profile, resolution: 1024, variations: 4, seed: 100, verify: false, refine: false, checks: [],
    compiler_version: '1'},
  images: [image(0, 100), image(1, 101), image(2, 102), image(3, 103)]} as unknown as Run);

it('redoes the variation on screen in the full profile, with its own seed', () => {
  const onRepeat = vi.fn(async () => undefined);
  render(<RunPanel run={run('turbo')} connection="online" onReuse={vi.fn()} notify={vi.fn()} onRepeat={onRepeat} />);
  fireEvent.click(screen.getByRole('button', {name: 'Refazer no Completo'}));
  expect(onRepeat).toHaveBeenCalledWith(true, {profile: 'qwen21', seed: 101});      // t1 is the best one, shown first
});

it('reuses the picture on screen for an edit, without the mask flag', () => {
  const onReuse = vi.fn();
  render(<RunPanel run={run('qwen21')} connection="online" onReuse={onReuse} notify={vi.fn()} onRepeat={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', {name: 'Editar este resultado'}));
  expect(onReuse).toHaveBeenCalledWith('1'.padEnd(64, '0'));      // t1 is the best one, shown first
});

it('"Corrigir área" reuses the picture on screen and asks for the mask editor', () => {
  const onReuse = vi.fn();
  render(<RunPanel run={run('qwen21')} connection="online" onReuse={onReuse} notify={vi.fn()} onRepeat={vi.fn()} />);
  const button = screen.getByRole('button', {name: 'Corrigir área'});
  expect(button.getAttribute('title')).toBe('Edita só uma parte deste resultado: pinte a área e descreva o que muda.');
  fireEvent.click(button);
  expect(onReuse).toHaveBeenCalledWith('1'.padEnd(64, '0'), {mask: true});
});

it('offers no redo for a result that is already in the full profile', () => {
  render(<RunPanel run={run('qwen21')} connection="online" onReuse={vi.fn()} notify={vi.fn()} onRepeat={vi.fn()} />);
  expect(screen.queryByRole('button', {name: 'Refazer no Completo'})).toBeNull();
});

it('warns when the variation on screen shows more faces than people asked for', () => {
  const crowded = run('qwen21');
  crowded.images[1] = {...crowded.images[1], detail: {found: 3, refined: 3, expected: 2}};
  render(<RunPanel run={crowded} connection="online" onReuse={vi.fn()} notify={vi.fn()} onRepeat={vi.fn()} />);
  expect(screen.getByText(/Foram encontradas 3 pessoas na imagem, e o pedido tem 2/)).toBeTruthy();
  expect(screen.getByTitle(/Variação 2 .* pessoa a mais\?/)).toBeTruthy();
  fireEvent.click(screen.getByTitle(/Variação 1 /));
  expect(screen.queryByText(/Foram encontradas/)).toBeNull();
});

it('also warns when the body detector counts more people than the faces show', () => {
  const crowded = run('qwen21');
  crowded.images[1] = {...crowded.images[1], detail: {found: 2, refined: 2, expected: 2, people: 3}};
  render(<RunPanel run={crowded} connection="online" onReuse={vi.fn()} notify={vi.fn()} onRepeat={vi.fn()} />);
  expect(screen.getByText(/Foram encontradas 3 pessoas na imagem, e o pedido tem 2/)).toBeTruthy();
});
