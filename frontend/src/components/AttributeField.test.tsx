// @vitest-environment happy-dom
import {cleanup, fireEvent, render, screen} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import type {Item, Suggestion} from '../api/types';
import {AttributeField} from './AttributeField';

afterEach(cleanup);

const items: Item[] = ['full', 'half'].map(f => ({id: `framing.${f}`, category: 'framing', label: f === 'full' ? 'Corpo inteiro' : 'Meio-corpo',
  prompt: f, adult: false, enabled: true, requirements: {}, provides: {framing: f as 'full'}}));
const offer = (id: string, label: string): Suggestion => ({field: 'framing', label, reason: 'A pose precisa de corpo inteiro.',
  attribute: {intent: 'set', value: {kind: 'catalog', item_id: id}}, context: {}, source: 'pose', auto: false});

it('offers the value the pose needs next to a field the person chose, one click away', () => {
  const onSuggest = vi.fn();
  render(<AttributeField category="framing" mode="edit" items={items} references={[]} issues={['O enquadramento não mostra a pose pedida.']}
    attribute={{intent: 'set', value: {kind: 'catalog', item_id: 'framing.half'}}} onChange={vi.fn()}
    suggestions={[offer('framing.full', 'Usar Corpo inteiro'), offer('framing.half', 'Usar Meio-corpo')]} onSuggest={onSuggest} />);
  expect(screen.getByText('A pose precisa de corpo inteiro.')).toBeTruthy();
  expect(screen.queryByRole('button', {name: 'Usar Meio-corpo'})).toBeNull();      // already the current value
  fireEvent.click(screen.getByRole('button', {name: 'Usar Corpo inteiro'}));
  expect(onSuggest).toHaveBeenCalledWith(expect.objectContaining({label: 'Usar Corpo inteiro'}));
});

it('offers lights that agree with the chosen setting, with the reason', () => {
  const lights: Item[] = [{id: 'lighting.night', category: 'lighting', label: 'Noite urbana', prompt: 'night', adult: false,
    enabled: true, requirements: {}, provides: {}}];
  const onSuggest = vi.fn();
  const window: Suggestion = {field: 'lighting', label: 'Luz de janela', reason: 'Combina com o cenário: interno, de dia.',
    attribute: {intent: 'set', value: {kind: 'catalog', item_id: 'lighting.window'}}, context: {}, source: 'scene', auto: false};
  render(<AttributeField category="lighting" mode="generate" items={lights} references={[]} issues={[]}
    attribute={{intent: 'set', value: {kind: 'catalog', item_id: 'lighting.night'}}} onChange={vi.fn()}
    suggestions={[window]} onSuggest={onSuggest} />);
  expect(screen.getByText('Combina com o cenário: interno, de dia.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', {name: 'Luz de janela'}));
  expect(onSuggest).toHaveBeenCalledWith(window);
});

it('marks a field the Studio filled, with the explanation on hover', () => {
  render(<AttributeField category="framing" mode="edit" items={items} references={[]} issues={[]} auto="action"
    attribute={{intent: 'set', value: {kind: 'catalog', item_id: 'framing.full'}}} onChange={vi.fn()} />);
  const mark = screen.getByText('pela ação');
  expect(mark.getAttribute('title')).toMatch(/não volta a mexer/);
});
