import {useEffect, useId, useState, type ReactNode} from 'react';
import {Icon} from './Icon';

// A hint shown on hover or keyboard focus, so explanations stay out of the form until asked for.
export function Tip({children, label = 'Mais informações'}: {children: ReactNode; label?: string}) {
  const id = useId();
  return (
    <span className="tip-anchor">
      <button type="button" className="tip-btn" aria-label={label} aria-describedby={id}><Icon name="info" size={14} /></button>
      <span role="tooltip" id={id} className="tip">{children}</span>
    </span>
  );
}

interface Option<T> {value: T; label: ReactNode; title?: string; disabled?: boolean}

// A short list of choices shown all at once (radio group).
export function Segmented<T extends string | number>({label, value, options, onChange, disabled, small}:
  {label: string; value: T; options: Option<T>[]; onChange: (value: T) => void; disabled?: boolean; small?: boolean}) {
  return (
    <div className={'segmented choice' + (small ? ' small' : '')} role="radiogroup" aria-label={label}>
      {options.map(option => (
        <button key={String(option.value)} type="button" role="radio" aria-checked={option.value === value}
                disabled={disabled || option.disabled} title={option.title} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

// On/off setting drawn as a switch; it stays a real checkbox for forms and screen readers.
export function Switch({checked, onChange, disabled, children, id}:
  {checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; children: ReactNode; id?: string}) {
  return (
    <label className={'switch' + (disabled ? ' disabled' : '')}>
      <input id={id} type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />
      <span className="switch-track" aria-hidden="true" />
      <span className="switch-text">{children}</span>
    </label>
  );
}

// A block that folds away and shows its current values in the title row. It opens by itself when `reveal`
// changes to a new value (a pending issue points at it).
export function Disclosure({title, summary, children, reveal, alert}:
  {title: string; summary?: ReactNode; children: ReactNode; reveal?: number; alert?: boolean}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  useEffect(() => {if (reveal) setOpen(true);}, [reveal]);
  useEffect(() => {if (alert) setOpen(true);}, [alert]);
  return (
    <div className={'disclosure' + (open ? ' open' : '')}>
      <button type="button" className="disclosure-head" aria-expanded={open} aria-controls={id} onClick={() => setOpen(o => !o)}>
        <strong>{title}</strong>
        {alert && <span className="dot warn" aria-label="Com pendência" />}
        {summary && <span className="disclosure-summary">{summary}</span>}
        <Icon name="chevron" size={15} />
      </button>
      {open && <div id={id} className="disclosure-body">{children}</div>}
    </div>
  );
}
