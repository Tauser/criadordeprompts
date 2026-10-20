import type {ReactNode} from 'react';
import type {Attribute, Category, Item, Reference} from '../api/types';
import {CATEGORY_LABELS} from '../lib/labels';
import {sortBy} from '../lib/sort';
import {TranslateButton} from './Translate';

interface Props {
  category: Category;
  attribute: Attribute;
  items: Item[];
  references: Reference[];
  targetId?: string | null;
  mode: 'generate' | 'edit';
  disabled?: boolean;
  issues: string[];
  onChange: (attribute: Attribute) => void;
  children?: ReactNode;
}

const keyOf = (a: Attribute) => a.intent === 'set' ? (a.value?.kind === 'catalog' ? `catalog:${a.value.item_id}` : 'text')
  : a.intent === 'transfer' ? `ref:${a.reference_id}` : a.intent;

export function AttributeField({category, attribute, items, references, targetId, mode, disabled, issues, onChange, children}: Props) {
  const key = keyOf(attribute);
  const id = `field-${category}`;
  const sources = sortBy(references.filter(r => r.id !== targetId), r => r.label);
  const sorted = sortBy(items, i => i.label);
  const known = new Set(['keep', 'free', 'text', ...items.map(i => `catalog:${i.id}`), ...sources.map(r => `ref:${r.id}`)]);
  const select = (value: string) => {
    if (value === 'keep' || value === 'free') onChange({intent: value});
    else if (value === 'text') onChange({intent: 'set', value: {kind: 'text', text: attribute.value?.kind === 'text' ? attribute.value.text : ''}});
    else if (value.startsWith('catalog:')) onChange({intent: 'set', value: {kind: 'catalog', item_id: value.slice(8)}});
    else if (value.startsWith('ref:')) onChange({intent: 'transfer', reference_id: value.slice(4)});
  };
  const defined = attribute.intent === 'set' || attribute.intent === 'transfer';
  const item = attribute.intent === 'set' && attribute.value?.kind === 'catalog'
    ? items.find(i => i.id === (attribute.value as {item_id: string}).item_id) : undefined;
  const source = attribute.intent === 'transfer' ? references.find(r => r.id === attribute.reference_id) : undefined;
  // Explanations stay out of the form: they appear on hover or keyboard focus.
  const description = attribute.intent === 'free' ? 'Sem instrução: o modelo decide.'
    : attribute.intent === 'keep' ? 'Fica como está na foto.'
    : item ? item.prompt_pt || item.prompt
    : source ? `Vem da imagem de referência “${source.label}”.` : null;
  const tipId = `${id}-tip`;
  return (
    <div className={'field' + (issues.length ? ' has-issue' : '') + (defined ? ' is-set' : '')}>
      <div className="field-label">
        <label htmlFor={id}>{CATEGORY_LABELS[category]}</label>
        {issues.length ? <span className="dot warn" title="Com conflito" /> : defined ? <span className="dot set" title="Definido" /> : null}
      </div>
      <div className="field-control">
        <select id={id} value={key} disabled={disabled} onChange={e => select(e.target.value)} className={defined ? '' : 'is-default'}
                aria-describedby={[description && tipId, issues.length && `${id}-issues`].filter(Boolean).join(' ') || undefined}>
          {mode === 'edit' && <option value="keep">Manter da foto</option>}
          <option value="free">Livre</option>
          <option value="text">Descrição personalizada…</option>
          {items.length > 0 && <optgroup label="Biblioteca">
            {sorted.map(item => <option key={item.id} value={`catalog:${item.id}`}>{item.label}{item.adult ? ' · +18' : ''}</option>)}
          </optgroup>}
          {sources.length > 0 && <optgroup label="Imagem de referência">
            {sources.map(ref => <option key={ref.id} value={`ref:${ref.id}`}>{ref.label}</option>)}
          </optgroup>}
          {!known.has(key) && <option value={key}>Seleção indisponível · revise</option>}
        </select>
        {description && <span role="tooltip" id={tipId} className="tip field-tip">{description}</span>}
      </div>
      {issues.length > 0 && <ul id={`${id}-issues`} className="field-issues">{issues.map(m => <li key={m}>{m}</li>)}</ul>}
      {attribute.intent === 'set' && attribute.value?.kind === 'text' && (<>
        <textarea rows={2} value={attribute.value.text} disabled={disabled} placeholder="Descreva em inglês (ou em português e traduza)"
                  aria-label={`Descrição de ${CATEGORY_LABELS[category]} em inglês`}
                  onChange={e => onChange({intent: 'set', value: {kind: 'text', text: e.target.value}})} />
        <TranslateButton label={CATEGORY_LABELS[category].toLowerCase()} text={attribute.value.text} disabled={disabled}
                         onTranslated={text => onChange({intent: 'set', value: {kind: 'text', text}})} />
      </>)}
      {children}
    </div>
  );
}
