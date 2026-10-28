// @vitest-environment happy-dom
import {useState} from 'react';
import {cleanup, fireEvent, render, screen, within} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import type {Item} from '../api/types';
import {addReference, addCharacter, initialWorkspace, type Workspace} from '../state/workspace';
import {AttributeField} from './AttributeField';
import {Cast} from './Cast';

vi.mock('../api/client', () => ({api: {characters: vi.fn(async () => ({characters: []}))},
  fileUrl: (hash: string) => `/api/files/${hash}`}));
afterEach(cleanup);

function Form({start, names}: {start: Workspace; names: string[]}) {
  const [workspace, update] = useState(start);
  return <Cast workspace={workspace} names={names} automatic update={update} notify={vi.fn()} />;
}
const withCharacter = () => {
  let ws = addReference(initialWorkspace('generate'), 'b', {hash: 'b'.repeat(64), width: 10, height: 10, name: 'Bia'});
  ws = addCharacter(ws, 'b');
  return ws;
};

it('lists everyone in the picture and sets who is a woman or a man, a second click clearing it', () => {
  render(<Form start={withCharacter()} names={['Pessoa 1', 'Pessoa 2 (Bia)']} />);
  expect(screen.getByText('2 pessoas · automático')).toBeTruthy();
  const woman = within(screen.getByRole('radiogroup', {name: 'Sexo de Pessoa 2 (Bia)'})).getByRole('radio', {name: 'Mulher'});
  fireEvent.click(woman);
  expect(woman.getAttribute('aria-checked')).toBe('true');
  fireEvent.click(woman);
  expect(woman.getAttribute('aria-checked')).toBe('false');
});

it('each character gets its place, its note and a way out of the cast', () => {
  render(<Form start={withCharacter()} names={['Pessoa 1', 'Pessoa 2 (Bia)']} />);
  const place = screen.getByLabelText('Posição do personagem 2') as HTMLSelectElement;
  fireEvent.change(place, {target: {value: 'left'}});
  expect(place.value).toBe('left');
  fireEvent.click(screen.getByRole('button', {name: 'Tirar do elenco'}));
  expect(screen.queryByLabelText('Posição do personagem 2')).toBeNull();
});

it('with one person it still offers the fichas, without asking for sexes', () => {
  render(<Form start={initialWorkspace('generate')} names={['Pessoa 1']} />);
  expect(screen.getByText('1 pessoa · automático')).toBeTruthy();
  expect(screen.queryByRole('radiogroup')).toBeNull();
  expect(screen.getByLabelText('Personagem principal da ficha')).toBeTruthy();
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
