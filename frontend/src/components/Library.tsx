import {useEffect, useMemo, useRef, useState} from 'react';
import {api} from '../api/client';
import {CATEGORIES, type Category, type Item, type LibrarySnapshot, type TextFinding} from '../api/types';
import {CATEGORY_LABELS, FRAMING_LABELS, GAZE_LABELS, ORIENTATION_LABELS, PERIOD_LABELS, PLACE_LABELS,
  POSTURE_LABELS} from '../lib/labels';
import {droppedBy, toCategory} from '../lib/libraryItem';
import {metadataLabel, missingMetadata} from '../lib/metadata';
import {compareText, sortBy} from '../lib/sort';
import {uuid} from '../lib/uuid';
import {TestPose} from './TestPose';
import {TranslateButton} from './Translate';

const SORTED_CATEGORIES = sortBy(CATEGORIES, c => CATEGORY_LABELS[c]);

interface Props {snapshot: LibrarySnapshot; onSaved: (s: LibrarySnapshot) => void; notify: (m: string, e?: boolean) => void;
  setDirty: (dirty: boolean) => void}

const POSTURES = ['', 'any', 'standing', 'seated', 'kneeling', 'all_fours', 'squatting', 'lying', 'supine', 'prone',
  'side_lying', 'walking', 'running'];
const ORIENTATIONS = ['', 'any', 'front', 'back', 'side', 'three_quarter'];
const GAZES = ['', 'any', 'camera', 'away', 'down', 'up', 'back', 'closed'];
const FRAMINGS = ['', 'portrait', 'half', 'full', 'wide'];
const PERIODS = ['', 'any', 'day', 'golden', 'blue', 'night'];
const PLACES = ['', 'any', 'indoor', 'outdoor'];
const SUPPORTS = ['floor', 'seat', 'bed', 'wall', 'table'] as const;
const SUPPORT_LABEL: Record<string, string> = {floor: 'chão', seat: 'assento', bed: 'cama', wall: 'parede', table: 'mesa'};

const sortedOptions = (values: string[], labels: Record<string, string>) =>
  ['', ...sortBy(values.filter(Boolean), v => labels[v] ?? v)];
const compareCategoryThenLabel = (a: Item, b: Item) =>
  SORTED_CATEGORIES.indexOf(a.category) - SORTED_CATEGORIES.indexOf(b.category) || compareText(a.label, b.label);

const LEVELS = [['conflict', 'Conflito', 'error'], ['ambiguity', 'Ambíguo', 'warning'], ['style', 'Redação', 'unknown']] as const;
const levelOf = (level: TextFinding['level']) => LEVELS.find(l => l[0] === level) ?? LEVELS[2];

const FIELD_NAMES: Record<string, string> = {participants: 'número de pessoas', posture: 'postura', orientation: 'orientação',
  gaze: 'olhar', support_any_of: 'apoios', minimum_framing: 'enquadramento mínimo', children: 'crianças',
  supports: 'superfícies', period: 'horário', place: 'ambiente', view: 'lado do corpo visto', framing: 'recorte'};

const blank = (category: Category): Item => ({id: `user.${category}.${uuid().slice(0, 8)}`, category,
  label: '', prompt: '', adult: false, enabled: true, requirements: {}, provides: {}});

export function Library({snapshot, onSaved, notify, setDirty}: Props) {
  const [category, setCategory] = useState<Category | 'all'>('all');
  const [query, setQuery] = useState('');
  const [incomplete, setIncomplete] = useState(false);
  const [mine, setMine] = useState(false);          // options created or edited by the user
  const [draft, setDraft] = useState<Item | null>(null);
  const [original, setOriginal] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const lastClicked = useRef<number | null>(null);
  const shiftHeld = useRef(false);                 // Shift+clique seleciona um intervalo
  // Answers that arrive after another item was opened must not touch it.
  const openId = useRef<string | null>(null);
  openId.current = draft?.id ?? null;
  const dirty = draft !== null && JSON.stringify(draft) !== original;
  // The backend refuses a category change only for the Studio's own options (built in or customized).
  const studioItem = !!draft && ['builtin', 'custom'].includes(snapshot.origins[draft.id] ?? '');
  const saved = original ? JSON.parse(original) as Item : null;
  const dropped = draft && saved && saved.category !== draft.category ? droppedBy(saved, draft.category) : [];
  // Wording review of the open item: text that contradicts its own metadata or can be read two ways.
  const [findings, setFindings] = useState<TextFinding[]>([]);
  useEffect(() => {
    if (!draft || !draft.prompt.trim() || !draft.label.trim()) {setFindings([]); return;}
    let current = true;
    const timer = window.setTimeout(() => {
      api.auditItem(draft).then(r => {if (current) setFindings(r.findings);}).catch(() => {if (current) setFindings([]);});
    }, 400);
    return () => {current = false; window.clearTimeout(timer);};
  }, [draft]);
  useEffect(() => setDirty(dirty), [dirty, setDirty]);
  // Review of every saved option at once; it only lists, nothing is changed. Refreshed after each save.
  const [review, setReview] = useState(false);
  const [report, setReport] = useState<Record<string, TextFinding[]> | null>(null);
  const [reviewError, setReviewError] = useState('');
  useEffect(() => {
    if (!review) {setReport(null); setReviewError(''); return;}
    let current = true;
    api.auditLibrary().then(r => {if (current) {setReport(r); setReviewError('');}})
      .catch(error => {if (current) setReviewError((error as Error).message || 'Não foi possível revisar a biblioteca.');});
    return () => {current = false;};
  }, [review, snapshot]);

  const isMine = (item: Item) => snapshot.origins[item.id] !== 'builtin';
  const matching = useMemo(() => snapshot.items.filter(item => (!incomplete || missingMetadata(item).length > 0)
    && (!mine || snapshot.origins[item.id] !== 'builtin')
    && (!review || !!report?.[item.id]?.length)
    && (!query || (item.label + ' ' + item.prompt).toLowerCase().includes(query.toLowerCase()))),
    [snapshot, query, incomplete, mine, review, report]);
  const items = useMemo(() => matching.filter(item => category === 'all' || item.category === category)
    .sort((a, b) => compareCategoryThenLabel(a, b)), [matching, category]);
  const perCategory = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of matching) counts[item.category] = (counts[item.category] ?? 0) + 1;
    return counts;
  }, [matching]);
  // Selection survives filtering; ids that no longer exist are dropped.
  useEffect(() => {
    const ids = new Set(snapshot.items.map(i => i.id));
    setSelected(current => [...current].every(id => ids.has(id)) ? current : new Set([...current].filter(id => ids.has(id))));
  }, [snapshot]);
  const visibleSelected = items.filter(i => selected.has(i.id)).length;
  const allVisible = items.length > 0 && visibleSelected === items.length;
  const toggleOne = (index: number, shift: boolean) => {
    const anchor = lastClicked.current;
    const range = shift && anchor !== null ? items.slice(Math.min(anchor, index), Math.max(anchor, index) + 1) : [items[index]];
    const on = !selected.has(items[index].id);
    setSelected(current => {
      const next = new Set(current);
      for (const item of range) {if (on) next.add(item.id); else next.delete(item.id);}
      return next;
    });
    lastClicked.current = index;
  };
  const toggleVisible = (on: boolean) => setSelected(current => {
    const next = new Set(current);
    for (const item of items) {if (on) next.add(item.id); else next.delete(item.id);}
    return next;
  });
  const tagsOf = (item: Item) => [category === 'all' && CATEGORY_LABELS[item.category], item.adult && '+18',
    !item.enabled && 'desativada', isMine(item) && 'sua'].filter(Boolean).join(' · ');
  const incompleteCount = useMemo(() => snapshot.items.filter(i => missingMetadata(i).length).length, [snapshot]);
  const mineCount = useMemo(() => snapshot.items.filter(i => snapshot.origins[i.id] !== 'builtin').length, [snapshot]);

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
    // Roles count only when every person has both names; all empty means the option names none.
    const roles = (draft.roles ?? []).slice(0, people).map(r => ({label: r.label.trim(), name: r.name.trim()}));
    const filled = roles.length === people && people > 1 && roles.every(r => r.label && r.name);
    if (!filled && roles.some(r => r.label || r.name)) {
      notify('Preencha os dois nomes de cada papel, ou deixe todos os papéis vazios.', true); return;
    }
    const cleaned = {...draft, edit_prompt: draft.edit_prompt?.trim() || null, roles: filled ? roles : []};
    if (await persist([...others, cleaned])) {
      if (openId.current === draft.id) setOriginal(JSON.stringify(draft));
      notify(cleaned.adult ? 'Opção salva. Ela é +18: na tela Criar, só aparece com "Mostrar opções adultas (+18)" ligado em Conteúdo.'
        : 'Opção salva.');
    }
  };
  const remove = async () => {
    if (!draft) return;
    const origin = snapshot.origins[draft.id];
    const message = origin === 'custom' ? 'Restaurar a versão padrão desta opção?' : 'Remover esta opção da biblioteca?';
    if (!confirm(message)) return;
    if (await persist(userItems().filter(i => i.id !== draft.id))) {
      if (openId.current === draft.id) {setDraft(null); setOriginal('');}
      notify('Biblioteca atualizada.');
    }
  };
  // Bulk actions. Built-in options cannot be deleted (they come from the catalog); they can be deactivated,
  // which hides them from the composer. Removing an edited built-in restores its default text.
  const chosen = () => snapshot.items.filter(i => selected.has(i.id));
  const releaseDraft = (ids: Set<string>) => {
    if (draft && ids.has(draft.id)) {setDraft(null); setOriginal('');}
  };
  const draftBlocks = (ids: Set<string>) => !!draft && ids.has(draft.id) && dirty
    && !confirm('A opção aberta tem alterações não salvas, que serão descartadas. Continuar?');
  const removeSelected = async () => {
    const list = chosen();
    const own = list.filter(i => snapshot.origins[i.id] === 'user');
    const custom = list.filter(i => snapshot.origins[i.id] === 'custom');
    const builtin = list.length - own.length - custom.length;
    if (!own.length && !custom.length) {
      notify('As opções padrão não podem ser apagadas. Use "Desativar" para escondê-las do compositor.', true);
      return;
    }
    const parts = [own.length && `${own.length} ${own.length === 1 ? 'opção sua será apagada' : 'opções suas serão apagadas'}`,
      custom.length && `${custom.length} ${custom.length === 1 ? 'opção padrão editada volta' : 'opções padrão editadas voltam'} ao texto original`,
      builtin && `${builtin} ${builtin === 1 ? 'opção padrão fica' : 'opções padrão ficam'} como ${builtin === 1 ? 'está' : 'estão'} (use "Desativar")`]
      .filter(Boolean).join('; ');
    const ids = new Set([...own, ...custom].map(i => i.id));
    if (!confirm(`Remover da biblioteca: ${parts}. Continuar?`) || draftBlocks(ids)) return;
    if (await persist(userItems().filter(i => !ids.has(i.id)))) {
      releaseDraft(ids);
      setSelected(current => new Set([...current].filter(id => !ids.has(id) || snapshot.origins[id] === 'custom')));
      notify(`${ids.size} ${ids.size === 1 ? 'opção removida' : 'opções removidas'}.`);
    }
  };
  const setEnabledSelected = async (enabled: boolean) => {
    const list = chosen().filter(i => i.enabled !== enabled);
    if (!list.length) {notify(enabled ? 'As selecionadas já estão ativas.' : 'As selecionadas já estão desativadas.'); return;}
    const ids = new Set(list.map(i => i.id));
    if (draftBlocks(ids)) return;
    const changed = list.map(i => ({...i, enabled}));
    if (await persist([...userItems().filter(i => !ids.has(i.id)), ...changed])) {
      releaseDraft(ids);
      notify(`${list.length} ${list.length === 1 ? 'opção' : 'opções'} ${enabled ? 'ativada' : 'desativada'}${list.length === 1 ? '' : 's'}.`);
    }
  };

  const prov = (key: string, value: string) => setDraft(d => d && {...d, provides: {...d.provides, [key]: value || null}});
  const req = (key: string, value: unknown) => setDraft(d => d && {...d, requirements: {...d.requirements, [key]: value === '' ? null : value}});
  const people = draft ? Number(draft.requirements.participants ?? 1) : 1;
  const roleAt = (index: number) => draft?.roles?.[index] ?? {label: '', name: ''};
  const setRole = (index: number, key: 'label' | 'name', value: string) => setDraft(d => {
    if (!d) return d;
    const roles = Array.from({length: people}, (_, i) => ({...(d.roles?.[i] ?? {label: '', name: ''})}));
    roles[index][key] = value;
    return {...d, roles};
  });

  return (
    <div className="library-page">
      <header className="page-head">
        <div>
          <h1>Biblioteca</h1>
          <p className="muted">As opções que aparecem no compositor. Edite o texto enviado ao modelo ou crie as suas.</p>
        </div>
        <button className="primary" onClick={() => open(blank(category === 'all' ? 'environment' : category))}>Nova opção</button>
      </header>
      <div className="library-toolbar">
        <label className="search"><span className="sr-only">Buscar</span>
          <input type="search" placeholder="Buscar por nome ou descrição" value={query} onChange={e => setQuery(e.target.value)} aria-label="Buscar opções" /></label>
        <label className="check"><input type="checkbox" checked={incomplete} onChange={e => setIncomplete(e.target.checked)} />
          Só metadados incompletos ({incompleteCount})</label>
        <label className="check" title="Mostra só as opções que você criou ou editou.">
          <input type="checkbox" checked={mine} onChange={e => setMine(e.target.checked)} />
          Só as minhas ({mineCount})</label>
        <label className="check" title="Revisa o texto de todas as opções salvas e mostra só as que têm avisos, agrupadas por nível. Nada é alterado.">
          <input type="checkbox" checked={review} onChange={e => setReview(e.target.checked)} />
          Revisar biblioteca{report ? ` (${Object.keys(report).length})` : ''}</label>
        <span className="muted small library-count">{items.length} opções</span>
      </div>
      <div className="chips category-chips" role="group" aria-label="Categoria">
        {(['all', ...SORTED_CATEGORIES] as (Category | 'all')[]).filter(c => c === 'all' || perCategory[c] || c === category).map(c => (
          <button key={c} aria-pressed={category === c} className={'chip' + (category === c ? ' active' : '')} onClick={() => setCategory(c)}>
            {c === 'all' ? 'Todas' : CATEGORY_LABELS[c]} <span>{c === 'all' ? matching.length : perCategory[c] ?? 0}</span></button>
        ))}
      </div>
      <div className="bulk-bar" role="toolbar" aria-label="Seleção">
        <label className="check"><input type="checkbox" checked={allVisible} disabled={!items.length}
          ref={el => {if (el) el.indeterminate = visibleSelected > 0 && !allVisible;}}
          onChange={e => toggleVisible(e.target.checked)} /> Selecionar todas as {items.length} visíveis</label>
        {selected.size > 0 && <>
          <span className="muted small">{selected.size} {selected.size === 1 ? 'selecionada' : 'selecionadas'}
            {selected.size !== visibleSelected ? ` (${selected.size - visibleSelected} fora do filtro)` : ''}</span>
          <span className="spacer" />
          <button className="quiet" disabled={saving} onClick={() => setEnabledSelected(false)}>Desativar</button>
          <button className="quiet" disabled={saving} onClick={() => setEnabledSelected(true)}>Ativar</button>
          <button className="quiet stop" disabled={saving} onClick={removeSelected}>Remover</button>
          <button className="quiet" onClick={() => setSelected(new Set())}>Limpar seleção</button>
        </>}
      </div>
      {incomplete && <p className="help">Sem esses dados, as regras não verificam conflitos e o compilador não acrescenta as orientações de postura, olhar e apoio.</p>}
    <div className="library">
      <section className="card list-card">
        {review ? <div className="review-groups" aria-label="Revisão da biblioteca">
          {reviewError && <p className="issue error review-note">{reviewError}</p>}
          {!report ? !reviewError && <p className="muted small review-note">Revisando a biblioteca…</p>
            : !items.length ? <p className="muted small review-note">Nenhuma opção com avisos{query || category !== 'all' || incomplete || mine ? ' neste filtro' : ''}.</p>
            : LEVELS.map(([level, name, tone]) => {
              const rows = items.filter(item => report[item.id]?.some(f => f.level === level));
              return rows.length > 0 && <section key={level} aria-label={name}>
                <h3 className={'review-level ' + tone}>{name}<span>{rows.length}</span></h3>
                <ul className="item-list">{rows.map(item => (
                  <li key={item.id} className="item-row">
                    <button className={'item' + (draft?.id === item.id ? ' selected' : '')} onClick={() => open(item)}>
                      <strong>{item.label}</strong>
                      {tagsOf(item) && <span className="muted small">{tagsOf(item)}</span>}
                      <span className="review-messages">{report[item.id].filter(f => f.level === level).map(f => (
                        <span key={f.code} className={'issue ' + tone}>{f.message}</span>))}</span>
                    </button>
                  </li>))}</ul>
              </section>;
            })}
        </div> : <ul className="item-list">
          {items.map((item, index) => (
            <li key={item.id} className={'item-row' + (selected.has(item.id) ? ' checked' : '')}>
              <input type="checkbox" checked={selected.has(item.id)} aria-label={`Selecionar ${item.label}`}
                     onMouseDown={e => {shiftHeld.current = e.shiftKey;}}
                     onChange={() => {toggleOne(index, shiftHeld.current); shiftHeld.current = false;}} />
              <button className={'item' + (draft?.id === item.id ? ' selected' : '')} onClick={() => open(item)}>
                <strong>{item.label}</strong>
                {tagsOf(item) && <span className="muted small">{tagsOf(item)}</span>}
                <span className="item-text">{item.prompt}</span>
                {missingMetadata(item).length > 0 && <span className="missing-meta">Falta: {missingMetadata(item).map(metadataLabel).join(', ')}</span>}
              </button>
            </li>
          ))}
        </ul>}
      </section>
      {!draft && <section className="card editor-empty"><h2>Escolha uma opção</h2>
        <p className="muted">Selecione um item da lista para ver e editar o texto que vai para o modelo, ou crie uma opção nova.</p></section>}
      {draft && (
        <section className="card editor" aria-labelledby="editor-title">
          <header className="editor-head">
            <h2 id="editor-title">{draft.label.trim() || 'Nova opção'}</h2>
            {dirty && <span className="badge undetermined">Alterações não salvas</span>}
            <span className="spacer" />
            {snapshot.origins[draft.id] && snapshot.origins[draft.id] !== 'builtin' &&
              <button className="quiet" onClick={remove} disabled={saving}>{snapshot.origins[draft.id] === 'custom' ? 'Restaurar padrão' : 'Remover'}</button>}
            <button className="quiet" onClick={() => open(null)}>Fechar</button>
            <button className="primary" onClick={save} disabled={saving || !dirty}>{saving ? 'Salvando…' : 'Salvar'}</button>
          </header>
          <div className="fields">
            <label>Categoria
              <select value={draft.category} disabled={studioItem}
                      title={studioItem ? 'Opções do Studio não mudam de categoria; crie uma opção nova na outra categoria.' : undefined}
                      onChange={e => setDraft(toCategory(draft, e.target.value as Category))}>
                {SORTED_CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
              </select>
              {dropped.length > 0 && <span className="issue warning">Na categoria {CATEGORY_LABELS[draft.category]} não
                existem {dropped.map(k => FIELD_NAMES[k] ?? k).join(', ')}: esses ajustes saem ao salvar.</span>}
            </label>
            <label>Nome<input value={draft.label} maxLength={80} onChange={e => setDraft({...draft, label: e.target.value})} /></label>
            <label>Descrição em inglês (é o texto enviado ao modelo)
              <textarea rows={4} value={draft.prompt} onChange={e => setDraft({...draft, prompt: e.target.value})} /></label>
            <TranslateButton key={`prompt-${draft.id}`} label="a descrição em inglês" text={draft.prompt}
                             onTranslated={text => setDraft(d => d && d.id === draft.id ? {...d, prompt: text} : d)} />
            {(draft.category === 'pose' || draft.category === 'action') && <TestPose key={`test-${draft.id}`} item={draft} />}
            <label>Instrução completa para edição (opcional, em inglês)
              <textarea rows={3} maxLength={2000} value={draft.edit_prompt ?? ''}
                        onChange={e => setDraft({...draft, edit_prompt: e.target.value})} /></label>
            <TranslateButton key={`edit-${draft.id}`} label="a instrução de edição" text={draft.edit_prompt ?? ''}
                             onTranslated={text => setDraft(d => d && d.id === draft.id ? {...d, edit_prompt: text} : d)} />
            <p className="help">Na edição, substitui a frase deste campo por uma instrução completa.
              Na criação de imagem nova, continua valendo a descrição acima. Os outros campos continuam sendo aplicados.</p>
            <label className="check"><input type="checkbox" checked={draft.adult} disabled={!draft.adult && !!draft.requirements.children} onChange={e => setDraft({...draft, adult: e.target.checked})} /> Conteúdo adulto (+18)</label>
            <label className="check"><input type="checkbox" checked={draft.enabled} onChange={e => setDraft({...draft, enabled: e.target.checked})} /> Ativa</label>
          </div>
          {findings.length > 0 && <ul className="issues" aria-label="Revisão do texto">{findings.map(f => (
            <li key={f.code} className={'issue ' + levelOf(f.level)[2]}>
              <span className="level">{levelOf(f.level)[1]}</span>{f.message}</li>))}</ul>}
          {missingMetadata(draft).length > 0 && <p className="issue warning">Falta informar: {missingMetadata(draft).map(metadataLabel).join(', ')}.
            Use "qualquer" ou deixe os apoios vazios quando a opção não exigir nada.</p>}
          {['pose', 'action', 'expression', 'subject'].includes(draft.category) && (
            <fieldset><legend>Metadados (usados nas regras)</legend>
              {draft.category !== 'expression' && <label>Pessoas<input type="number" min={1} max={10} value={draft.requirements.participants ?? ''}
                onChange={e => req('participants', e.target.value === '' ? '' : Number(e.target.value))} /></label>}
              {['pose', 'action'].includes(draft.category) && <label>Postura<select value={draft.requirements.posture ?? ''}
                onChange={e => req('posture', e.target.value)}>{sortedOptions(POSTURES, POSTURE_LABELS).map(p => <option key={p} value={p}>{p ? POSTURE_LABELS[p] : 'não informada'}</option>)}</select></label>}
              {['pose', 'action'].includes(draft.category) && <label>Orientação para a câmera<select value={draft.requirements.orientation ?? ''}
                onChange={e => req('orientation', e.target.value)}>{sortedOptions(ORIENTATIONS, ORIENTATION_LABELS).map(p => <option key={p} value={p}>{p ? ORIENTATION_LABELS[p] : 'não informada'}</option>)}</select></label>}
              {draft.category !== 'subject' && <label>Olhar<select value={draft.requirements.gaze ?? ''}
                onChange={e => req('gaze', e.target.value)}>{sortedOptions(GAZES, GAZE_LABELS).map(p => <option key={p} value={p}>{p ? GAZE_LABELS[p] : 'não informado'}</option>)}</select></label>}
              {['pose', 'action'].includes(draft.category) && <>
                <label>Enquadramento mínimo<select value={draft.requirements.minimum_framing ?? ''}
                  onChange={e => req('minimum_framing', e.target.value)}>{sortedOptions(FRAMINGS, FRAMING_LABELS).map(p => <option key={p} value={p}>{p ? FRAMING_LABELS[p] : 'nenhum'}</option>)}</select></label>
                <label className="check"><input type="checkbox" checked={Array.isArray(draft.requirements.support_any_of) && draft.requirements.support_any_of.length === 0}
                  onChange={e => req('support_any_of', e.target.checked ? [] : '')} /> Nenhum apoio necessário</label>
                <div className="checks" role="group" aria-label="Apoios aceitos">{SUPPORTS.map(s => (
                  <label key={s} className="check"><input type="checkbox" checked={!!draft.requirements.support_any_of?.includes(s)}
                    onChange={e => {
                      const now = new Set(draft.requirements.support_any_of ?? []);
                      if (e.target.checked) now.add(s); else now.delete(s);
                      req('support_any_of', now.size ? [...now] : '');
                    }} /> {SUPPORT_LABEL[s]}</label>))}</div>
                {people > 1 && people <= 4 && (
                  <div className="roles" role="group" aria-label="Papéis">
                    <span className="control-label" title="Dê um nome a cada papel e escreva como o texto em inglês o chama. Na tela Criar, cada pessoa recebe um papel, com um botão para inverter.">Papéis</span>
                    {Array.from({length: people}, (_, i) => (
                      <div key={i} className="role-row">
                        <input aria-label={`Papel ${i + 1}: nome na tela`} placeholder={i === 0 ? 'quem carrega' : 'quem monta'}
                               maxLength={40} value={roleAt(i).label} onChange={e => setRole(i, 'label', e.target.value)} />
                        <input aria-label={`Papel ${i + 1}: como o texto chama`} placeholder={i === 0 ? 'the carrier' : 'the rider'}
                               maxLength={60} value={roleAt(i).name} onChange={e => setRole(i, 'name', e.target.value)} />
                      </div>
                    ))}
                  </div>
                )}
                <label className="check" title="Com crianças na cena, o prompt pede proporções de acordo com a idade de cada pessoa. Opções adultas não podem incluir crianças.">
                  <input type="checkbox" checked={!!draft.requirements.children} disabled={draft.adult && !draft.requirements.children}
                    onChange={e => req('children', e.target.checked ? true : '')} /> A cena inclui crianças</label>
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
          {['environment', 'lighting'].includes(draft.category) && (
            <fieldset><legend>Horário e ambiente (comparados entre luz e cenário)</legend>
              <div className="fields two">
                <label>Horário<select value={draft.provides.period ?? ''} onChange={e => prov('period', e.target.value)}>
                  {sortedOptions(PERIODS, PERIOD_LABELS).map(p => <option key={p} value={p}>{p ? PERIOD_LABELS[p] : 'não informado'}</option>)}</select></label>
                <label>Ambiente<select value={draft.provides.place ?? ''} onChange={e => prov('place', e.target.value)}>
                  {sortedOptions(PLACES, PLACE_LABELS).map(p => <option key={p} value={p}>{p ? PLACE_LABELS[p] : 'não informado'}</option>)}</select></label>
              </div>
            </fieldset>
          )}
          {draft.category === 'camera' && (
            <fieldset><legend>Câmera (comparada com a pose e o enquadramento)</legend>
              <div className="fields two">
                <label>Lado do corpo visto<select value={draft.provides.view ?? ''} onChange={e => prov('view', e.target.value)}>
                  {sortedOptions(ORIENTATIONS, ORIENTATION_LABELS).map(p => <option key={p} value={p}>{p ? ORIENTATION_LABELS[p] : 'não informado'}</option>)}</select></label>
                <label>Recorte típico da lente<select value={draft.provides.framing ?? ''} onChange={e => prov('framing', e.target.value)}>
                  {sortedOptions(FRAMINGS, FRAMING_LABELS).map(p => <option key={p} value={p}>{p ? FRAMING_LABELS[p] : 'não informado'}</option>)}</select></label>
              </div>
            </fieldset>
          )}
          {draft.category === 'framing' && (
            <label>Área visível<select value={draft.provides.framing ?? ''}
              onChange={e => setDraft({...draft, provides: {...draft.provides, framing: (e.target.value || null) as Item['provides']['framing']}})}>
              {sortedOptions(FRAMINGS, FRAMING_LABELS).map(p => <option key={p} value={p}>{p ? FRAMING_LABELS[p] : 'não informada'}</option>)}</select></label>
          )}
        </section>
      )}
    </div>
    </div>
  );
}
