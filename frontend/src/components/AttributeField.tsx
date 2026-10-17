import type {Attribute, Category, Item, Reference} from '../api/types';
import {CATEGORY_LABELS} from '../lib/labels';
import {sortBy} from '../lib/sort';

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
}

const keyOf = (a: Attribute) => a.intent === 'set' ? (a.value?.kind === 'catalog' ? `catalog:${a.value.item_id}` : 'text')
  : a.intent === 'transfer' ? `ref:${a.reference_id}` : a.intent;

export function AttributeField({category, attribute, items, references, targetId, mode, disabled, issues, onChange}: Props) {
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
  return (
    <div className={'field' + (issues.length ? ' has-issue' : '')}>
      <label htmlFor={id}>{CATEGORY_LABELS[category]}</label>
      <select id={id} value={key} disabled={disabled} onChange={e => select(e.target.value)}
              aria-describedby={issues.length ? `${id}-issues` : undefined}>
        {mode === 'edit' && <option value="keep">Manter da foto</option>}
        <option value="free">Sem instrução (o modelo decide)</option>
        <option value="text">Descrição personalizada…</option>
        {items.length > 0 && <optgroup label="Biblioteca">
          {sorted.map(item => <option key={item.id} value={`catalog:${item.id}`}>{item.label}{item.adult ? ' · +18' : ''}</option>)}
        </optgroup>}
        {sources.length > 0 && <optgroup label="Imagem de referência">
          {sources.map(ref => <option key={ref.id} value={`ref:${ref.id}`}>{ref.label}</option>)}
        </optgroup>}
        {!known.has(key) && <option value={key}>Seleção indisponível · revise</option>}
      </select>
      {attribute.intent === 'set' && attribute.value?.kind === 'text' && (
        <textarea rows={2} value={attribute.value.text} disabled={disabled} placeholder="Descreva em inglês"
                  aria-label={`Descrição de ${CATEGORY_LABELS[category]} em inglês`}
                  onChange={e => onChange({intent: 'set', value: {kind: 'text', text: e.target.value}})} />
      )}
      {attribute.intent === 'set' && attribute.value?.kind === 'catalog' && (() => {
        const item = items.find(i => i.id === (attribute.value as {item_id: string}).item_id);
        return item?.prompt_pt ? <p className="field-pt">{item.prompt_pt}</p> : null;
      })()}
      {issues.length > 0 && <ul id={`${id}-issues`} className="field-issues">{issues.map(m => <li key={m}>{m}</li>)}</ul>}
    </div>
  );
}
