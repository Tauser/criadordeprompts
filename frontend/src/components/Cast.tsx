import type {Sex} from '../api/types';
import {Segmented} from './Controls';

interface Props {
  names: string[];                 // everyone in the result, the first person first
  sexes: (Sex | null)[];
  automatic: boolean;              // the count comes from the choices, not from a number the person typed
  disabled?: boolean;
  issues?: string[];
  onSex: (person: number, sex: Sex | null) => void;
}

// Everyone the picture will show, at the top of the request: who they are and who is a woman or a man.
export function Cast({names, sexes, automatic, disabled, issues = [], onSex}: Props) {
  if (names.length < 2) return null;
  return (
    <section className="card cast" aria-labelledby="cast-title">
      <div className="section-title">
        <h2 id="cast-title">Elenco</h2>
        <span className="muted small" title={automatic ? 'O número vem das fotos, fichas e opções escolhidas. Para fixar outro, use Avançado → Cena.'
          : 'Número fixado em Avançado → Cena.'}>{names.length} pessoas{automatic ? ' · automático' : ''}</span>
      </div>
      <ul className="cast-list">
        {names.map((name, i) => (
          <li key={i} className="cast-person">
            <span className="cast-name" title={name}>{name}</span>
            <Segmented<Sex | ''> small label={`Sexo de ${name}`} value={sexes[i] ?? ''} disabled={disabled}
              options={[{value: 'female', label: 'Mulher'}, {value: 'male', label: 'Homem'}]}
              onChange={value => onSex(i + 1, value === sexes[i] ? null : value || null)} />
          </li>
        ))}
      </ul>
      {issues.length > 0 && <ul className="field-issues">{issues.map(m => <li key={m}>{m}</li>)}</ul>}
    </section>
  );
}
