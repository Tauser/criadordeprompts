import type {Role} from '../api/types';
import {Icon} from './Icon';

interface Props {
  roles: Role[];
  order: number[];            // order[k]: the role of person k + 1
  names: string[];            // how each person is called on screen
  disabled?: boolean;
  onChange: (order: number[]) => void;
}

/** The order the option's roles go to, or the option's own order when the saved one does not fit it. */
export const fittedOrder = (order: number[] | undefined, count: number) =>
  order && order.length === count && [...order].sort().every((r, i) => r === i) ? order : [...Array(count).keys()];

// Who takes which role of a pose or action that names its roles: one line per person, swapped with a click.
export function RoleCast({roles, order, names, disabled, onChange}: Props) {
  const current = fittedOrder(order, roles.length);
  const give = (person: number, role: number) => {
    const next = [...current];
    const other = next.indexOf(role);
    [next[person], next[other]] = [role, next[person]];
    onChange(next);
  };
  return (
    <div className="field-extra role-cast">
      <span className="control-label">Quem faz qual papel</span>
      <ul>
        {current.map((role, person) => (
          <li key={person}>
            <span className="role-person">{names[person] ?? `Pessoa ${person + 1}`}</span>
            <span aria-hidden="true">→</span>
            {roles.length === 2 ? <strong>{roles[role].label}</strong> : (
              <select aria-label={`Papel de ${names[person] ?? `Pessoa ${person + 1}`}`} value={role} disabled={disabled}
                      onChange={e => give(person, Number(e.target.value))}>
                {roles.map((r, i) => <option key={i} value={i}>{r.label}</option>)}
              </select>
            )}
          </li>
        ))}
      </ul>
      {roles.length === 2 && (
        <button type="button" className="quiet" disabled={disabled} onClick={() => onChange([current[1], current[0]])}
                title="Troca os papéis entre as duas pessoas">
          <Icon name="refresh" size={13} />Inverter</button>
      )}
    </div>
  );
}
