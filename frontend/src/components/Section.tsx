import type {ReactNode} from 'react';
import {Icon} from './Icon';

interface Props {id: string; title: string; summary?: string; open: boolean; onToggle: (id: string) => void; children: ReactNode}

// Collapsible inspector group, like the property panels of a professional editor.
export function Section({id, title, summary, open, onToggle, children}: Props) {
  return (
    <section className={'inspector-section' + (open ? ' open' : '')}>
      <button className="section-head" aria-expanded={open} aria-controls={`section-${id}`} onClick={() => onToggle(id)}>
        <span className="chev"><Icon name="chevron" size={14} /></span>
        <span className="section-name">{title}</span>
        {summary && <span className="section-summary">{summary}</span>}
      </button>
      {open && <div id={`section-${id}`} className="section-body">{children}</div>}
    </section>
  );
}
