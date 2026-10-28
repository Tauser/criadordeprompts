// @vitest-environment happy-dom
import {cleanup, fireEvent, render, screen, within} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import type {Item} from '../api/types';
import {AttributeField} from './AttributeField';
import {Cast} from './Cast';

afterEach(cleanup);

it('lists everyone in the picture and sets who is a woman or a man', () => {
  const onSex = vi.fn();
  render(<Cast names={['Pessoa 1 (Tauser)', 'Pessoa 2 (Janaina)']} sexes={['male', null]} automatic onSex={onSex} />);
  expect(screen.getByText('2 pessoas · automático')).toBeTruthy();
  fireEvent.click(within(screen.getByRole('radiogroup', {name: 'Sexo de Pessoa 2 (Janaina)'})).getByRole('radio', {name: 'Mulher'}));
  expect(onSex).toHaveBeenCalledWith(2, 'female');
  fireEvent.click(within(screen.getByRole('radiogroup', {name: 'Sexo de Pessoa 1 (Tauser)'})).getByRole('radio', {name: 'Homem'}));
  expect(onSex).toHaveBeenCalledWith(1, null);                 // a second click clears it
});

it('stays out of the way with a single person', () => {
  render(<Cast names={['Pessoa 1']} sexes={[]} automatic onSex={vi.fn()} />);
  expect(screen.queryByText('Elenco')).toBeNull();
});

const option = (id: string, label: string, participants: number): Item => ({id, category: 'action', label, prompt: label,
  adult: false, enabled: true, requirements: {participants}, provides: {}});

it('puts the options that fit the cast first', () => {
  const items = [option('a.solo', 'Acenar', 1), option('a.duo', 'Abraçar', 2), option('a.trio', 'Torcida', 3)];
  render(<AttributeField category="action" attribute={{intent: 'free'}} items={items} references={[]} mode="generate"
                         issues={[]} onChange={vi.fn()} fit={2} />);
  const groups = screen.getAllByRole('group').map(g => g.getAttribute('label'));
  expect(groups).toEqual(['Para 2 pessoas', 'Outras quantidades de pessoas']);
  expect(within(screen.getAllByRole('group')[0]).getAllByRole('option').map(o => o.textContent)).toEqual(['Abraçar']);
});
