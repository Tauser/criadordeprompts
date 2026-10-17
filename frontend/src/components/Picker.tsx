import {useEffect, useMemo, useRef, useState} from 'react';
import type {Attribute, Category, Item, StudioRequest} from '../api/types';
import {CATEGORY_LABELS} from '../lib/labels';
import {sortBy} from '../lib/sort';
import {Icon} from './Icon';

export const GROUPS: {id: string; title: string; icon: string; categories: Category[]}[] = [
  {id: 'person', title: 'Quem aparece', icon: 'person', categories: ['subject', 'face', 'body', 'skin', 'hair', 'wardrobe']},
  {id: 'pose', title: 'Pose e ação', icon: 'pose', categories: ['pose', 'action', 'expression']},
  {id: 'scene', title: 'Cena', icon: 'scene', categories: ['environment', 'lighting', 'style', 'camera', 'framing']},
];

interface Props {
  category: Category; request: StudioRequest; itemsFor: (c: Category) => Item[]; issuesByField: Record<string, string[]>;
  onCategory: (c: Category) => void; onChange: (c: Category, a: Attribute) => void; onClose: () => void;
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function Picker({category, request, itemsFor, issuesByField, onCategory, onChange, onClose}: Props) {
  const [query, setQuery] = useState('');
  const search = useRef<HTMLInputElement>(null);
  const attribute = request.attributes[category] ?? {intent: request.mode === 'edit' ? 'keep' : 'free'};
  const edit = request.mode === 'edit';
  const manual = request.prompt_mode === 'manual';
  const items = useMemo(() => sortBy(itemsFor(category), i => i.label)
    .filter(i => !query || norm(i.label + ' ' + (i.prompt_pt ?? '') + ' ' + i.prompt).includes(norm(query))), [itemsFor, category, query]);
  const sources = request.references.filter(r => r.id !== request.target_id);
  const issues = issuesByField[`attributes.${category}`] ?? [];

  useEffect(() => {setQuery(''); search.current?.focus();}, [category]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {if (event.key === 'Escape') {event.stopPropagation(); onClose();}};
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);

  const selectedItem = attribute.intent === 'set' && attribute.value?.kind === 'catalog' ? attribute.value.item_id : null;
  const set = (a: Attribute) => onChange(category, a);
  const valueOf = (c: Category) => {
    const a = request.attributes[c];
    if (!a || a.intent === 'keep' || (a.intent === 'free' && !edit)) return null;
    if (a.intent === 'free') return 'livre';
    if (a.intent === 'transfer') return 'referência';
    if (a.value?.kind === 'text') return 'texto';
    return itemsFor(c).find(i => i.id === (a.value as {item_id: string}).item_id)?.label ?? '—';
  };

  return (
    <div className="scrim" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="sheet picker" role="dialog" aria-modal="true" aria-label={`Escolher ${CATEGORY_LABELS[category]}`}>
        <nav className="picker-nav" aria-label="Atributos">
          {GROUPS.map(group => (
            <div key={group.id} className="picker-group">
              <p className="picker-group-title"><Icon name={group.icon} size={14} />{group.title}</p>
              {group.categories.map(c => {
                const value = valueOf(c);
                const issue = issuesByField[`attributes.${c}`]?.length;
                return (
                  <button key={c} aria-current={c === category ? 'true' : undefined} onClick={() => onCategory(c)}
                          className={(value ? 'has-value' : '') + (issue ? ' has-issue' : '')}>
                    <span className="picker-nav-name">{CATEGORY_LABELS[c]}</span>{value && <span className="picker-nav-value">{value}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="picker-main">
          <header className="picker-head">
            <h2>{CATEGORY_LABELS[category]}</h2>
            <label className="search"><Icon name="search" size={15} />
              <input ref={search} value={query} onChange={e => setQuery(e.target.value)} placeholder={`Buscar em ${CATEGORY_LABELS[category].toLowerCase()}`}
                     aria-label="Buscar opções" /></label>
            <button className="btn-done" onClick={onClose}>Concluir</button>
          </header>
          {manual && <p className="note warn">O prompt está sendo escrito à mão: estas escolhas só valem quando você voltar aos campos.</p>}
          {issues.map(m => <p key={m} className="note warn">{m}</p>)}
          <div className="picker-scroll">
            <div className="option-row">
              {edit && <button className={'option special' + (attribute.intent === 'keep' ? ' selected' : '')} aria-pressed={attribute.intent === 'keep'}
                onClick={() => set({intent: 'keep'})}><strong>Manter da foto</strong><span>Não muda nada aqui.</span></button>}
              <button className={'option special' + (attribute.intent === 'free' ? ' selected' : '')} aria-pressed={attribute.intent === 'free'}
                onClick={() => set({intent: 'free'})}><strong>{edit ? 'O modelo decide' : 'Automático'}</strong>
                <span>{edit ? 'Sem instrução: pode mudar livremente.' : 'Sem instrução para este item.'}</span></button>
              <button className={'option special' + (attribute.intent === 'set' && attribute.value?.kind === 'text' ? ' selected' : '')}
                aria-pressed={attribute.intent === 'set' && attribute.value?.kind === 'text'}
                onClick={() => set({intent: 'set', value: {kind: 'text', text: attribute.value?.kind === 'text' ? attribute.value.text : ''}})}>
                <strong>Escrever</strong><span>Sua própria descrição, em inglês.</span></button>
              {sources.map(ref => (
                <button key={ref.id} className={'option special' + (attribute.intent === 'transfer' && attribute.reference_id === ref.id ? ' selected' : '')}
                  aria-pressed={attribute.intent === 'transfer' && attribute.reference_id === ref.id}
                  onClick={() => set({intent: 'transfer', reference_id: ref.id})}>
                  <strong>Da imagem</strong><span>{ref.label}</span></button>
              ))}
            </div>
            {attribute.intent === 'set' && attribute.value?.kind === 'text' && (
              <textarea className="picker-text" rows={3} autoFocus value={attribute.value.text} placeholder="Ex.: a red silk dress with thin straps"
                aria-label={`Descrição de ${CATEGORY_LABELS[category]} em inglês`}
                onChange={e => set({intent: 'set', value: {kind: 'text', text: e.target.value}})} />
            )}
            <p className="picker-count">{items.length} {items.length === 1 ? 'opção' : 'opções'} na biblioteca{query ? ` para “${query}”` : ''}</p>
            <div className="option-grid" role="group" aria-label={`Opções de ${CATEGORY_LABELS[category]}`}>
              {items.map(item => (
                <button key={item.id} className={'option' + (selectedItem === item.id ? ' selected' : '')} aria-pressed={selectedItem === item.id}
                        onClick={() => set(selectedItem === item.id ? {intent: edit ? 'keep' : 'free'} : {intent: 'set', value: {kind: 'catalog', item_id: item.id}})}>
                  <strong>{item.label}</strong>
                  {item.prompt_pt && <span>{item.prompt_pt}</span>}
                  {item.adult && <em className="adult">+18</em>}
                  {selectedItem === item.id && <i className="option-check"><Icon name="check" size={12} /></i>}
                </button>
              ))}
              {!items.length && <p className="muted">Nada encontrado. Tente outra palavra ou escreva sua descrição.</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
