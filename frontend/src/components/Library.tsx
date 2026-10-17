import {useEffect, useMemo, useState} from 'react';
import {api} from '../api/client';
import {CATEGORIES, type Category, type Item, type LibrarySnapshot} from '../api/types';
import {CATEGORY_LABELS} from '../lib/labels';

interface Props {snapshot: LibrarySnapshot; onSaved: (s: LibrarySnapshot) => void; notify: (m: string, e?: boolean) => void;
  setDirty: (dirty: boolean) => void}

const POSTURES = ['', 'any', 'standing', 'seated', 'kneeling', 'lying', 'walking', 'running'];
const GAZES = ['', 'any', 'camera', 'away', 'down', 'up', 'back', 'closed'];
const FRAMINGS = ['', 'portrait', 'half', 'full', 'wide'];
const SUPPORTS = ['floor', 'seat', 'bed', 'wall', 'table'] as const;
const SUPPORT_LABEL: Record<string, string> = {floor: 'chão', seat: 'assento', bed: 'cama', wall: 'parede', table: 'mesa'};

const blank = (category: Category): Item => ({id: `user.${category}.${crypto.randomUUID().slice(0, 8)}`, category,
  label: '', prompt: '', prompt_pt: '', adult: false, enabled: true, requirements: {}, provides: {}});

export function Library({snapshot, onSaved, notify, setDirty}: Props) {
  const [category, setCategory] = useState<Category | 'all'>('all');
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<Item | null>(null);
  const [original, setOriginal] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [translating, setTranslating] = useState(false);
  const dirty = draft !== null && JSON.stringify(draft) !== original;
  useEffect(() => setDirty(dirty), [dirty, setDirty]);

  const items = useMemo(() => snapshot.items.filter(item => (category === 'all' || item.category === category)
    && (!query || (item.label + ' ' + item.prompt).toLowerCase().includes(query.toLowerCase()))), [snapshot, category, query]);

  const open = (item: Item | null) => {
    if (dirty && !confirm('Descartar as alterações não salvas?')) return;
    setDraft(item ? structuredClone(item) : null);
    setOriginal(item ? JSON.stringify(item) : '');
  };
  const userItems = () => snapshot.items.filter(i => snapshot.origins[i.id] !== 'builtin');
  const persist = async (items: Item[]) => {
    setSaving(true);
    try {
      const saved = await api.saveLibrary(snapshot.revision, items);
      onSaved(saved);
      return saved;
    } catch (error) {
      notify((error as Error).message, true);
      return null;
    } finally {setSaving(false);}
  };
  const save = async () => {
    if (!draft) return;
    if (!draft.label.trim() || !draft.prompt.trim()) {notify('Preencha o nome e a descrição em inglês.', true); return;}
    const others = userItems().filter(i => i.id !== draft.id);
    const cleaned = {...draft, prompt_pt: draft.prompt_pt || null};
    if (await persist([...others, cleaned])) {setOriginal(JSON.stringify(draft)); notify('Opção salva.');}
  };
  const remove = async () => {
    if (!draft) return;
    const origin = snapshot.origins[draft.id];
    const message = origin === 'custom' ? 'Restaurar a versão padrão desta opção?' : 'Remover esta opção da biblioteca?';
    if (!confirm(message)) return;
    if (await persist(userItems().filter(i => i.id !== draft.id))) {setDraft(null); setOriginal(''); notify('Biblioteca atualizada.');}
  };
  const translate = async () => {
    if (!draft?.prompt_pt?.trim()) return;
    setTranslating(true);
    try {
      const job = await api.translate(draft.prompt_pt);
      for (let i = 0; i < 180; i++) {
        await new Promise(r => setTimeout(r, 1500));
        const state = await api.translation(job.id);
        if (state.status === 'completed' && state.text) {
          if (!draft.prompt || confirm(`Substituir a descrição em inglês por:\n\n${state.text}`))
            setDraft(d => d && {...d, prompt: state.text!});
          return;
        }
        if (['failed', 'cancelled'].includes(state.status)) throw new Error(state.error || 'A tradução falhou.');
      }
      throw new Error('A tradução demorou demais.');
    } catch (error) {notify((error as Error).message, true);} finally {setTranslating(false);}
  };
  const req = (key: string, value: unknown) => setDraft(d => d && {...d, requirements: {...d.requirements, [key]: value === '' ? null : value}});

  return (
    <div className="library">
      <section className="card">
        <div className="row">
          <select aria-label="Categoria" value={category} onChange={e => setCategory(e.target.value as Category | 'all')}>
            <option value="all">Todas as categorias</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
          </select>
          <input type="search" placeholder="Buscar" value={query} onChange={e => setQuery(e.target.value)} aria-label="Buscar opções" />
          <button className="secondary" onClick={() => open(blank(category === 'all' ? 'environment' : category))}>Nova opção</button>
        </div>
        <ul className="item-list">
          {items.map(item => (
            <li key={item.id}>
              <button className={'item' + (draft?.id === item.id ? ' selected' : '')} onClick={() => open(item)}>
                <strong>{item.label}</strong>
                <span className="muted small">{CATEGORY_LABELS[item.category]}{item.adult ? ' · +18' : ''}{!item.enabled ? ' · desativada' : ''}
                  {snapshot.origins[item.id] !== 'builtin' ? ' · sua' : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      {draft && (
        <section className="card editor" aria-label="Editar opção">
          <div className="fields">
            <label>Categoria
              <select value={draft.category} disabled={snapshot.origins[draft.id] !== undefined}
                      onChange={e => setDraft({...draft, category: e.target.value as Category})}>
                {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
              </select>
            </label>
            <label>Nome<input value={draft.label} maxLength={80} onChange={e => setDraft({...draft, label: e.target.value})} /></label>
            <label>Descrição em português (opcional)
              <textarea rows={3} value={draft.prompt_pt ?? ''} onChange={e => setDraft({...draft, prompt_pt: e.target.value})} /></label>
            <button className="quiet" disabled={translating || !draft.prompt_pt?.trim()} onClick={translate}>
              {translating ? 'Traduzindo no modelo local…' : 'Traduzir para inglês'}</button>
            <label>Descrição em inglês (enviada ao modelo)
              <textarea rows={4} value={draft.prompt} onChange={e => setDraft({...draft, prompt: e.target.value})} /></label>
            <label className="check"><input type="checkbox" checked={draft.adult} onChange={e => setDraft({...draft, adult: e.target.checked})} /> Conteúdo adulto (+18)</label>
            <label className="check"><input type="checkbox" checked={draft.enabled} onChange={e => setDraft({...draft, enabled: e.target.checked})} /> Ativa</label>
          </div>
          {['pose', 'action', 'expression', 'subject'].includes(draft.category) && (
            <fieldset><legend>Metadados (usados nas regras)</legend>
              {draft.category !== 'expression' && <label>Pessoas<input type="number" min={1} max={10} value={draft.requirements.participants ?? ''}
                onChange={e => req('participants', e.target.value === '' ? '' : Number(e.target.value))} /></label>}
              {['pose', 'action'].includes(draft.category) && <label>Postura<select value={draft.requirements.posture ?? ''}
                onChange={e => req('posture', e.target.value)}>{POSTURES.map(p => <option key={p} value={p}>{p || 'não informada'}</option>)}</select></label>}
              {draft.category !== 'subject' && <label>Olhar<select value={draft.requirements.gaze ?? ''}
                onChange={e => req('gaze', e.target.value)}>{GAZES.map(p => <option key={p} value={p}>{p || 'não informado'}</option>)}</select></label>}
              {['pose', 'action'].includes(draft.category) && <>
                <label>Enquadramento mínimo<select value={draft.requirements.minimum_framing ?? ''}
                  onChange={e => req('minimum_framing', e.target.value)}>{FRAMINGS.map(p => <option key={p} value={p}>{p || 'nenhum'}</option>)}</select></label>
                <div className="checks" role="group" aria-label="Apoios aceitos">{SUPPORTS.map(s => (
                  <label key={s} className="check"><input type="checkbox" checked={!!draft.requirements.support_any_of?.includes(s)}
                    onChange={e => {
                      const now = new Set(draft.requirements.support_any_of ?? []);
                      if (e.target.checked) now.add(s); else now.delete(s);
                      req('support_any_of', now.size ? [...now] : '');
                    }} /> {SUPPORT_LABEL[s]}</label>))}</div>
              </>}
            </fieldset>
          )}
          {draft.category === 'environment' && (
            <fieldset><legend>Apoios disponíveis neste cenário</legend>
              <div className="checks">{SUPPORTS.map(s => (
                <label key={s} className="check"><input type="checkbox" checked={!!draft.provides.supports?.includes(s)}
                  onChange={e => {
                    const now = new Set(draft.provides.supports ?? []);
                    if (e.target.checked) now.add(s); else now.delete(s);
                    setDraft({...draft, provides: {...draft.provides, supports: now.size ? [...now] : null}});
                  }} /> {SUPPORT_LABEL[s]}</label>))}</div>
            </fieldset>
          )}
          {draft.category === 'framing' && (
            <label>Área visível<select value={draft.provides.framing ?? ''}
              onChange={e => setDraft({...draft, provides: {...draft.provides, framing: (e.target.value || null) as Item['provides']['framing']}})}>
              {FRAMINGS.map(p => <option key={p} value={p}>{p || 'não informada'}</option>)}</select></label>
          )}
          <div className="row">
            {snapshot.origins[draft.id] && snapshot.origins[draft.id] !== 'builtin' &&
              <button className="quiet" onClick={remove} disabled={saving}>{snapshot.origins[draft.id] === 'custom' ? 'Restaurar padrão' : 'Remover'}</button>}
            <span className="spacer" />
            <button className="quiet" onClick={() => open(null)}>Fechar</button>
            <button className="primary" onClick={save} disabled={saving || !dirty}>{saving ? 'Salvando…' : 'Salvar'}</button>
          </div>
        </section>
      )}
    </div>
  );
}
