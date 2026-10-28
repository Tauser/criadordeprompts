// @vitest-environment happy-dom
import {cleanup, fireEvent, render, screen} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import {RoleCast, fittedOrder} from './RoleCast';

afterEach(cleanup);

const RIDE = [{label: 'quem carrega', name: 'the carrier'}, {label: 'quem monta', name: 'the rider'}];

it('says who takes which role and swaps the two with one click', () => {
  const onChange = vi.fn();
  render(<RoleCast roles={RIDE} order={[]} names={['Pessoa 1 (Tauser)', 'Pessoa 2 (Janaina)']} onChange={onChange} />);
  const lines = screen.getAllByRole('listitem').map(li => li.textContent);
  expect(lines).toEqual(['Pessoa 1 (Tauser)→quem carrega', 'Pessoa 2 (Janaina)→quem monta']);
  fireEvent.click(screen.getByRole('button', {name: /Inverter/}));
  expect(onChange).toHaveBeenCalledWith([1, 0]);
});

it('with more people, each picks a role and the one who had it takes the other', () => {
  const onChange = vi.fn();
  const roles = [...RIDE, {label: 'quem assiste', name: 'the watcher'}];
  render(<RoleCast roles={roles} order={[0, 1, 2]} names={['A', 'B', 'C']} onChange={onChange} />);
  fireEvent.change(screen.getByLabelText('Papel de A'), {target: {value: '2'}});
  expect(onChange).toHaveBeenCalledWith([2, 1, 0]);
});

it('an order kept from another option falls back to the option own order', () => {
  expect(fittedOrder([1, 0], 2)).toEqual([1, 0]);
  expect(fittedOrder([2, 0, 1], 2)).toEqual([0, 1]);
  expect(fittedOrder(undefined, 3)).toEqual([0, 1, 2]);
});
