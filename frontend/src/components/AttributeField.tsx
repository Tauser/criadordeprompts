import type {ReactNode} from 'react';
import type {Attribute, Category, Item, Reference, Suggestion} from '../api/types';
import {CATEGORY_LABELS} from '../lib/labels';
import {groupByPrefix} from '../lib/groups';
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
  auto?: 'pose' | 'action';                   // filled by the Studio for the pose or action
  suggestions?: Suggestion[];                 // values that fit the pose or action, one click away
  onSuggest?: (suggestion: Suggestion) => void;
  hiddenAdult?: number;                       // +18 options this field does not list in the standard mode
  children?: ReactNode;
}

const SOURCE = {pose: 'pela pose', action: 'pela ação'};

const keyOf = (a: Attribute) => a.intent === 'set' ? (a.value?.kind === 'catalog' ? `catalog:${a.value.item_id}` : 'text')
  : a.intent === 'transfer' ? `ref:${a.reference_id}` : a.intent;

export function AttributeField({category, attribute, items, references, targetId, mode, disabled, issues, onChange, auto,
  suggestions = [], onSuggest, hiddenAdult = 0, children}: Props) {
  const key = keyOf(attribute);
  const id = `field-${category}`;
  const sources = sortBy(references.filter(r => r.id !== targetId), r => r.label);
  const groups = groupByPrefix(items, i => i.label);
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
  const offered = suggestions.filter(s => !s.attribute || keyOf(s.attribute) !== key);
  return (
    <div className={'field' + (issues.length ? ' has-issue' : '') + (defined ? ' is-set' : '')}>
      <div className="field-label">
        <label htmlFor={id}>{CATEGORY_LABELS[category]}</label>
        {issues.length ? <span className="dot warn" title="Com conflito" /> : defined ? <span className="dot set" title="Definido" /> : null}
        {auto && <span className="auto-mark" tabIndex={0}
          title={`Preenchido ${SOURCE[auto]} para evitar conflitos. Mude o campo para escolher outro valor; o Studio não volta a mexer nele.`}>
          {SOURCE[auto]}</span>}
        {hiddenAdult > 0 && <span className="auto-mark hidden-adult" tabIndex={0}
          title='Ligue "Mostrar opções adultas (+18)" em Conteúdo para ver e escolher essas opções.'>
          {hiddenAdult} {hiddenAdult === 1 ? 'opção +18 oculta' : 'opções +18 ocultas'}</span>}
      </div>
      <div className="field-control">
        <select id={id} value={key} disabled={disabled} onChange={e => select(e.target.value)} className={defined ? '' : 'is-default'}
                aria-describedby={[description && tipId, issues.length && `${id}-issues`].filter(Boolean).join(' ') || undefined}>
          {mode === 'edit' && <option value="keep">Manter da foto</option>}
          <option value="free">Livre</option>
          <option value="text">Descrição personalizada…</option>
          {groups.map(group => <optgroup key={group.name} label={groups.length > 1 ? group.name : 'Biblioteca'}>
            {group.items.map(item => <option key={item.id} value={`catalog:${item.id}`}>{item.label}{item.adult ? ' · +18' : ''}</option>)}
          </optgroup>)}
          {sources.length > 0 && <optgroup label="Imagem de referência">
            {sources.map(ref => <option key={ref.id} value={`ref:${ref.id}`}>{ref.label}</option>)}
          </optgroup>}
          {!known.has(key) && <option value={key}>Seleção indisponível · revise</option>}
        </select>
        {description && <span role="tooltip" id={tipId} className="tip field-tip">{description}</span>}
      </div>
      {issues.length > 0 && <ul id={`${id}-issues`} className="field-issues">{issues.map(m => <li key={m}>{m}</li>)}</ul>}
      {offered.length > 0 && onSuggest && <div className="field-fixes" role="group" aria-label={`Sugestões para ${CATEGORY_LABELS[category]}`}>
        <span className="field-fix-reason">{(offered.find(s => s.attribute) ?? offered[0]).reason}</span>
        {offered.map(s => <button key={s.label} type="button" className="btn-link" disabled={disabled}
          title={s.attribute ? undefined : s.reason} onClick={() => onSuggest(s)}>{s.label}</button>)}
      </div>}
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
