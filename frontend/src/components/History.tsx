import {useCallback, useEffect, useMemo, useState} from 'react';
import {api, fileUrl} from '../api/client';
import type {Run} from '../api/types';
import {RUN_STATUS, TERMINAL} from '../lib/labels';
import {relativeTime} from '../lib/time';

type Filter = 'all' | 'completed' | 'active' | 'problems';
const FILTERS: Record<Filter, string> = {all: 'Todos', completed: 'Concluídos', active: 'Em andamento', problems: 'Falhas e cancelados'};
const matches = (run: Run, filter: Filter) => filter === 'all' ? true : filter === 'completed' ? run.status === 'completed'
  : filter === 'active' ? !TERMINAL.has(run.status) : ['failed', 'cancelled', 'lost'].includes(run.status);

function summary(run: Run): string {
  const lines = (run.effective_prompt ?? run.prompt ?? '').split('\n').filter(Boolean);
  return lines.find(line => !/^(Create an image|Edit (the image|<image1>))\.?$/.test(line)) ?? lines[0] ?? '';
}

interface Props {activeRun: string | null; onSelect: (id: string | null) => void; keepFiles: string[];
  notify: (message: string, error?: boolean) => void}

export function History({activeRun, onSelect, keepFiles, notify}: Props) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  const refresh = useCallback(() => api.runs().then(r => {setRuns(r.runs); setError(null);})
    .catch(e => setError((e as Error).message)), []);
  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => window.clearInterval(timer);
  }, [refresh, activeRun]);

  const visible = useMemo(() => runs.filter(run => matches(run, filter)), [runs, filter]);
  const counts = useMemo(() => Object.fromEntries((Object.keys(FILTERS) as Filter[]).map(f => [f, runs.filter(r => matches(r, f)).length])), [runs]);

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
      refresh();
    } catch (e) {notify((e as Error).message, true);} finally {setDeleting(false);}
  };
  const toggle = (id: string) => setSelected(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <section className="card history-card" aria-labelledby="history-title">
      <div className="section-title">
        <h2 id="history-title">Histórico <span className="muted small">{runs.length}</span></h2>
        <div className="row tight">
          {selecting ? <>
            <button className="quiet" onClick={() => setSelected(new Set(visible.filter(r => TERMINAL.has(r.status)).map(r => r.id)))}>Todos</button>
            <button className="stop" disabled={!selected.size || deleting} onClick={() => remove([...selected])}>
              {deleting ? 'Apagando…' : `Apagar (${selected.size})`}</button>
            <button className="quiet" onClick={() => {setSelecting(false); setSelected(new Set());}}>Cancelar</button>
          </> : <button className="quiet" disabled={!runs.length} onClick={() => setSelecting(true)}>Selecionar</button>}
        </div>
      </div>
      <div className="chips" role="tablist" aria-label="Filtrar histórico">
        {(Object.keys(FILTERS) as Filter[]).map(f => (
          <button key={f} role="tab" aria-selected={filter === f} className={'chip' + (filter === f ? ' active' : '')}
                  onClick={() => setFilter(f)}>{FILTERS[f]} <span>{counts[f]}</span></button>
        ))}
      </div>
      {error && <p className="issue warning">{error}</p>}
      <ul className="history-grid">
        {visible.map(run => {
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
                  {selecting && terminal && <span className={'tick' + (checked ? ' on' : '')} aria-hidden="true">✓</span>}
                </span>
                <span className="tile-meta">
                  <strong>{run.mode === 'edit' ? 'Edição' : 'Criação'}</strong>
                  <span className="muted small">{relativeTime(run.created_at)}</span>
                </span>
                <span className="tile-summary">{summary(run)}</span>
              </button>
              {!selecting && terminal && (
                <button className="tile-delete" aria-label="Apagar este pedido" title="Apagar" onClick={() => remove([run.id])}>🗑</button>
              )}
            </li>
          );
        })}
      </ul>
      {!visible.length && !error && <p className="muted">{runs.length ? 'Nenhum pedido neste filtro.' : 'Os pedidos aparecem aqui.'}</p>}
    </section>
  );
}
