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

it('offers no redo for a result that is already in the full profile', () => {
  render(<RunPanel run={run('qwen21')} connection="online" onReuse={vi.fn()} notify={vi.fn()} onRepeat={vi.fn()} />);
  expect(screen.queryByRole('button', {name: 'Refazer no Completo'})).toBeNull();
});
