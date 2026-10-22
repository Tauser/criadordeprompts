import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {api, fileUrl} from '../api/client';
import type {Run} from '../api/types';
import {RUN_STATUS, TERMINAL} from '../lib/labels';
import {relativeTime} from '../lib/time';
import {useCollapsed} from '../lib/useCollapsed';
import {CollapseButton} from './Collapse';
import {Icon} from './Icon';

const PREVIEW = 8;   // tiles shown before "Ver todos"
const PAGE = 30;     // runs asked for per request
const SEARCH_DELAY = 300;

type Filter = 'all' | 'completed' | 'active' | 'problems';
const FILTERS: Record<Filter, string> = {all: 'Todos', completed: 'Concluídos', active: 'Em andamento', problems: 'Falhas e cancelados'};
const matches = (run: Run, filter: Filter) => filter === 'all' ? true : filter === 'completed' ? run.status === 'completed'
  : filter === 'active' ? !TERMINAL.has(run.status) : ['failed', 'cancelled', 'lost'].includes(run.status);

type Kind = 'all' | 'generate' | 'edit';
const KINDS: Record<Kind, string> = {all: 'Todos', generate: 'Geração', edit: 'Edição'};

function summary(run: Run): string {
  const lines = (run.effective_prompt ?? run.prompt ?? '').split('\n').filter(Boolean);
  return lines.find(line => !/^(Create an image|Edit (the image|<image1>))\.?$/.test(line)) ?? lines[0] ?? '';
}

interface Page {runs: Run[]; next: number | null}

// Keeps the extra pages already loaded when the first page is refreshed in the background.
function mergeFirstPage(prev: Page, fresh: {runs: Run[]; next_before: number | null}): Page {
  if (!fresh.runs.length) return {runs: [], next: null};
  const last = fresh.runs[fresh.runs.length - 1].created_at;
  const ids = new Set(fresh.runs.map(r => r.id));
  const tail = prev.runs.filter(r => !ids.has(r.id) && r.created_at < last);
  return {runs: [...fresh.runs, ...tail], next: tail.length ? prev.next : fresh.next_before};
}

interface Props {activeRun: string | null; onSelect: (id: string | null) => void; keepFiles: string[];
  notify: (message: string, error?: boolean) => void}

export function History({activeRun, onSelect, keepFiles, notify}: Props) {
  const [page, setPage] = useState<Page>({runs: [], next: null});
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<Kind>('all');
  const [loadingMore, setLoadingMore] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [collapsed, toggleCollapsed] = useCollapsed('history');
  const [expanded, setExpanded] = useState(false);
  const runs = page.runs;

  // Answers for an older search or filter are dropped; the first page replaces the list when the search changes.
  const keyRef = useRef('');
  const pendingReset = useRef(true);
  const seqRef = useRef(0);
  const keyOf = (q: string, k: Kind) => `${q}\n${k}`;
  const params = (q: string, k: Kind) => ({q: q || undefined, mode: k === 'all' ? undefined : k});

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query.trim()), SEARCH_DELAY);
    return () => window.clearTimeout(timer);
  }, [query]);

  const refresh = useCallback(() => {
    const key = keyOf(search, kind);
    if (keyRef.current !== key) {keyRef.current = key; pendingReset.current = true;}
    const seq = ++seqRef.current;
    api.runs({...params(search, kind), limit: PAGE}).then(r => {
      if (seq !== seqRef.current) return;
      const reset = pendingReset.current;
      pendingReset.current = false;
      setError(null);
      setPage(prev => reset ? {runs: r.runs, next: r.next_before} : mergeFirstPage(prev, r));
    }).catch(e => {if (seq === seqRef.current) setError((e as Error).message);});
  }, [search, kind]);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => window.clearInterval(timer);
  }, [refresh, activeRun]);

  const loadMore = async () => {
    if (!page.next) return;
    const key = keyOf(search, kind);
    setLoadingMore(true);
    try {
      const r = await api.runs({...params(search, kind), limit: PAGE, before: page.next});
      if (key !== keyRef.current) return;
      setPage(prev => ({runs: [...prev.runs, ...r.runs.filter(x => !prev.runs.some(p => p.id === x.id))], next: r.next_before}));
    } catch (e) {notify((e as Error).message, true);} finally {setLoadingMore(false);}
  };

  const visible = useMemo(() => runs.filter(run => matches(run, filter)), [runs, filter]);
  const counts = useMemo(() => Object.fromEntries((Object.keys(FILTERS) as Filter[]).map(f => [f, runs.filter(r => matches(r, f)).length])), [runs]);
  const searching = search !== '' || kind !== 'all';

  const remove = async (ids: string[]) => {
    const open = ids.filter(id => !TERMINAL.has(runs.find(r => r.id === id)?.status ?? ''));
    if (open.length) {notify('Pare os pedidos em andamento antes de apagá-los.', true); return;}
    const label = ids.length === 1 ? 'este pedido' : `${ids.length} pedidos`;
    if (!confirm(`Apagar ${label} do histórico? As imagens geradas também saem do Studio (as cópias na pasta de saída do ComfyUI continuam).`)) return;
    setDeleting(true);
    try {
      const result = await api.deleteRuns(ids, keepFiles);
      if (activeRun && result.deleted.includes(activeRun)) onSelect(null);
      setSelected(new Set()); setSelecting(false);
      notify(`${result.deleted.length} ${result.deleted.length === 1 ? 'pedido apagado' : 'pedidos apagados'}.`);
      pendingReset.current = true;   // the deleted runs may sit in pages already loaded
      refresh();
    } catch (e) {notify((e as Error).message, true);} finally {setDeleting(false);}
  };
  const toggle = (id: string) => setSelected(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <section className={'card history-card collapsible' + (collapsed ? ' is-collapsed' : '')} aria-labelledby="history-title">
      <div className="section-title">
        <h2 id="history-title">Histórico <span className="muted small">{runs.length}</span></h2>
        <div className="row tight">
          {!collapsed && <>
          {selecting ? <>
            <button className="quiet" onClick={() => setSelected(new Set(visible.filter(r => TERMINAL.has(r.status)).map(r => r.id)))}>Todos</button>
            <button className="stop" disabled={!selected.size || deleting} onClick={() => remove([...selected])}>
              {deleting ? 'Apagando…' : `Apagar (${selected.size})`}</button>
            <button className="quiet" onClick={() => {setSelecting(false); setSelected(new Set());}}>Cancelar</button>
          </> : <button className="quiet" disabled={!runs.length} onClick={() => setSelecting(true)}>Selecionar</button>}
          </>}
          <CollapseButton collapsed={collapsed} onToggle={toggleCollapsed} controls="history-body" label="histórico" />
        </div>
      </div>
      {!collapsed && <div id="history-body">
      <div className="history-search">
        <input type="search" placeholder="Buscar no histórico" value={query} onChange={e => setQuery(e.target.value)}
               aria-label="Buscar no histórico" />
      </div>
      <div className="chips" role="group" aria-label="Tipo de pedido">
        {(Object.keys(KINDS) as Kind[]).map(k => (
          <button key={k} aria-pressed={kind === k} className={'chip' + (kind === k ? ' active' : '')}
                  onClick={() => setKind(k)}>{KINDS[k]}</button>
        ))}
      </div>
      <div className="chips" role="group" aria-label="Filtrar histórico">
        {(Object.keys(FILTERS) as Filter[]).map(f => (
          <button key={f} aria-pressed={filter === f} className={'chip' + (filter === f ? ' active' : '')}
                  onClick={() => setFilter(f)}>{FILTERS[f]} <span>{counts[f]}</span></button>
        ))}
      </div>
      {error && <p className="issue warning">{error}</p>}
      <ul className="history-grid">
        {(expanded || selecting ? visible : visible.slice(0, PREVIEW)).map(run => {
          const images = run.images.filter(i => i.files.length);
          const best = images.find(i => i.task_id === run.best_task_id) ?? images[0];
          const terminal = TERMINAL.has(run.status);
          const checked = selected.has(run.id);
          return (
            <li key={run.id} className={'history-tile' + (run.id === activeRun ? ' active' : '') + (checked ? ' checked' : '')}>
              <button className="tile-main" aria-pressed={selecting ? checked : run.id === activeRun}
                      disabled={selecting && !terminal}
                      onClick={() => selecting ? toggle(run.id) : onSelect(run.id)}
                      title={selecting && !terminal ? 'Em andamento: não pode ser apagado' : summary(run)}>
                <span className="thumb">
                  {best ? <img src={fileUrl(best.files[0])} alt="" loading="lazy" /> : <span className="thumb-empty">{RUN_STATUS[run.status] ?? run.status}</span>}
                  <span className={'status-dot ' + run.status}>{RUN_STATUS[run.status] ?? run.status}</span>
                  {images.length > 1 && <span className="count">×{images.length}</span>}
                  {selecting && terminal && <span className={'tick' + (checked ? ' on' : '')} aria-hidden="true"><Icon name="check" size={12} /></span>}
                </span>
                <span className="tile-meta">
                  <strong>{run.mode === 'edit' ? 'Edição' : 'Criação'}</strong>
                  <span className="muted small">{relativeTime(run.created_at)}</span>
                </span>
                <span className="tile-summary">{summary(run)}</span>
              </button>
              {!selecting && terminal && (
                <button className="tile-delete" aria-label="Apagar este pedido" title="Apagar" onClick={() => remove([run.id])}><Icon name="trash" size={14} /></button>
              )}
            </li>
          );
        })}
      </ul>
      {visible.length > PREVIEW && !selecting && (
        <button className="quiet history-more" onClick={() => setExpanded(e => !e)}>
          {expanded ? 'Mostrar menos' : `Ver todos (${visible.length})`}</button>
      )}
      {page.next && (expanded || selecting) && (
        <button className="quiet history-more" disabled={loadingMore} onClick={loadMore}>
          {loadingMore ? 'Carregando…' : 'Carregar mais'}</button>
      )}
      {!visible.length && !error && <p className="muted">{runs.length ? 'Nenhum pedido neste filtro.'
        : searching ? 'Nada encontrado.' : 'Os pedidos que você gerar aparecem aqui.'}</p>}
      </div>}
    </section>
  );
}
