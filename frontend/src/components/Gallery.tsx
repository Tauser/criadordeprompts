import {useCallback, useEffect, useMemo, useState} from 'react';
import {api, fileUrl} from '../api/client';
import type {Run} from '../api/types';
import {PHASE, RUN_STATUS, TERMINAL} from '../lib/labels';
import {Icon} from './Icon';

type Filter = 'all' | 'generate' | 'edit' | 'problems';
const FILTERS: Record<Filter, string> = {all: 'Tudo', generate: 'Criações', edit: 'Edições', problems: 'Falhas'};
const matches = (run: Run, filter: Filter) => filter === 'all' ? true : filter === 'problems'
  ? ['failed', 'cancelled', 'lost'].includes(run.status) : run.mode === filter;

function dayLabel(seconds: number): string {
  const date = new Date(seconds * 1000), today = new Date();
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((start(today) - start(date)) / 86400000);
  if (days <= 0) return 'Hoje';
  if (days === 1) return 'Ontem';
  if (days < 7) return date.toLocaleDateString('pt-BR', {weekday: 'long'}).replace(/^./, c => c.toUpperCase());
  return date.toLocaleDateString('pt-BR', {day: 'numeric', month: 'long', year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric'});
}
const clock = (seconds: number) => new Date(seconds * 1000).toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'});

function liveLabel(run: Run): string {
  const task = run.tasks?.find(t => t.status === 'running') ?? run.tasks?.find(t => !TERMINAL.has(t.status));
  const live = task?.live;
  if (live?.phase) return (PHASE[live.phase] ?? live.phase) + (live.value != null && live.maximum ? ` · ${live.value}/${live.maximum}` : '');
  return RUN_STATUS[run.status] ?? run.status;
}

interface Props {activeRun: string | null; liveRun: Run | null; onOpen: (id: string) => void; keepFiles: string[];
  notify: (message: string, error?: boolean) => void; onOrder?: (ids: string[]) => void; onDeleted?: (ids: string[]) => void}

export function Gallery({activeRun, liveRun, onOpen, keepFiles, notify, onOrder, onDeleted}: Props) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  const refresh = useCallback(() => api.runs().then(r => {setRuns(r.runs); setError(null); setLoaded(true);})
    .catch(e => {setError((e as Error).message); setLoaded(true);}), []);
  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => window.clearInterval(timer);
  }, [refresh, activeRun, liveRun?.status]);

  // The followed run streams live; prefer that copy over the polled one.
  const merged = useMemo(() => {
    if (!liveRun) return runs;
    return runs.some(r => r.id === liveRun.id) ? runs.map(r => r.id === liveRun.id ? {...r, ...liveRun} : r) : [liveRun, ...runs];
  }, [runs, liveRun]);
  const visible = useMemo(() => merged.filter(run => matches(run, filter)), [merged, filter]);
  const counts = useMemo(() => Object.fromEntries((Object.keys(FILTERS) as Filter[]).map(f => [f, merged.filter(r => matches(r, f)).length])), [merged]);
  const groups = useMemo(() => {
    const out: {label: string; runs: Run[]}[] = [];
    for (const run of visible) {
      const label = dayLabel(run.created_at);
      if (out[out.length - 1]?.label === label) out[out.length - 1].runs.push(run); else out.push({label, runs: [run]});
    }
    return out;
  }, [visible]);
  const orderKey = visible.map(r => r.id).join(',');
  useEffect(() => {onOrder?.(orderKey ? orderKey.split(',') : []);}, [orderKey, onOrder]);

  const remove = async (ids: string[]) => {
    const open = ids.filter(id => !TERMINAL.has(merged.find(r => r.id === id)?.status ?? ''));
    if (open.length) {notify('Pare os pedidos em andamento antes de apagá-los.', true); return;}
    const label = ids.length === 1 ? 'este pedido' : `${ids.length} pedidos`;
    if (!confirm(`Apagar ${label}? As imagens geradas também saem do Studio (as cópias na pasta de saída do ComfyUI continuam).`)) return;
    setDeleting(true);
    try {
      const result = await api.deleteRuns(ids, keepFiles);
      onDeleted?.(result.deleted);
      setSelected(new Set()); setSelecting(false);
      notify(`${result.deleted.length} ${result.deleted.length === 1 ? 'pedido apagado' : 'pedidos apagados'}.`);
      refresh();
    } catch (e) {notify((e as Error).message, true);} finally {setDeleting(false);}
  };
  const toggle = (id: string) => setSelected(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <section className="gallery" aria-labelledby="gallery-title">
      <header className="gallery-head">
        <h1 id="gallery-title">Suas imagens</h1>
        <div className="segmented small" role="tablist" aria-label="Filtrar">
          {(Object.keys(FILTERS) as Filter[]).map(f => (
            <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}>
              {FILTERS[f]} <span className="count">{counts[f]}</span></button>
          ))}
        </div>
        <div className="gallery-actions">
          {selecting ? <>
            <span className="muted">{selected.size} {selected.size === 1 ? 'selecionado' : 'selecionados'}</span>
            <button className="btn-quiet" onClick={() => setSelected(new Set(visible.filter(r => TERMINAL.has(r.status)).map(r => r.id)))}>Selecionar tudo</button>
            <button className="btn-danger" disabled={!selected.size || deleting} onClick={() => remove([...selected])}>
              <Icon name="trash" size={14} />{deleting ? 'Apagando…' : 'Apagar'}</button>
            <button className="btn-quiet" onClick={() => {setSelecting(false); setSelected(new Set());}}>Cancelar</button>
          </> : <button className="btn-quiet" disabled={!merged.length} onClick={() => setSelecting(true)}><Icon name="select" size={14} />Selecionar</button>}
        </div>
      </header>
      {error && <p className="note warn">{error}</p>}

      {groups.map(group => (
        <div key={group.label} className="day">
          <h2 className="day-title">{group.label}</h2>
          <ul className="grid">
            {group.runs.map(run => {
              const images = run.images.filter(i => i.files.length);
              const best = images.find(i => i.task_id === run.best_task_id) ?? images[0];
              const terminal = TERMINAL.has(run.status);
              const checked = selected.has(run.id);
              const problem = ['failed', 'cancelled', 'lost'].includes(run.status);
              return (
                <li key={run.id} className={'tile' + (run.id === activeRun ? ' current' : '') + (checked ? ' checked' : '')
                  + (!terminal ? ' running' : '') + (problem ? ' problem' : '')}>
                  <button className="tile-open" aria-pressed={selecting ? checked : undefined} disabled={selecting && !terminal}
                          onClick={() => selecting ? toggle(run.id) : onOpen(run.id)}
                          aria-label={`${run.mode === 'edit' ? 'Edição' : 'Criação'} das ${clock(run.created_at)}, ${RUN_STATUS[run.status] ?? run.status}`}>
                    {best ? <img src={fileUrl(best.files[0])} alt="" loading="lazy" />
                      : <span className="tile-empty">{!terminal && <span className="spinner" aria-hidden="true" />}
                          <span>{terminal ? RUN_STATUS[run.status] ?? run.status : liveLabel(run)}</span></span>}
                    <span className="tile-meta">
                      <span>{run.mode === 'edit' ? 'Edição' : 'Criação'} · {clock(run.created_at)}</span>
                      {images.length > 1 && <span className="tile-count">{images.length}</span>}
                    </span>
                    {problem && best && <span className="tile-flag">{RUN_STATUS[run.status]}</span>}
                    {selecting && terminal && <span className={'tick' + (checked ? ' on' : '')} aria-hidden="true"><Icon name="check" size={12} /></span>}
                  </button>
                  {!selecting && terminal && (
                    <button className="tile-delete" aria-label="Apagar este pedido" title="Apagar" onClick={() => remove([run.id])}><Icon name="trash" size={14} /></button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {loaded && !visible.length && !error && (
        <div className="gallery-empty">
          {merged.length ? <p>Nenhum pedido neste filtro.</p> : <>
            <span className="logo big" aria-hidden="true" />
            <h2>Comece pela primeira imagem</h2>
            <p>Escolha pessoa, cenário e luz no compositor abaixo. Os resultados aparecem aqui.</p>
          </>}
        </div>
      )}
    </section>
  );
}
