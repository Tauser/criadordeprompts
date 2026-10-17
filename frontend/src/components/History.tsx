import {useEffect, useState} from 'react';
import {api, fileUrl} from '../api/client';
import type {Run} from '../api/types';
import {RUN_STATUS} from '../lib/labels';

export function History({activeRun, onSelect}: {activeRun: string | null; onSelect: (id: string) => void}) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let closed = false;
    const refresh = () => api.runs().then(r => {if (!closed) {setRuns(r.runs); setError(null);}})
      .catch(e => !closed && setError((e as Error).message));
    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => {closed = true; window.clearInterval(timer);};
  }, [activeRun]);
  return (
    <section className="card" aria-labelledby="history-title">
      <h2 id="history-title">Histórico</h2>
      {error && <p className="issue warning">{error}</p>}
      <ul className="history">
        {runs.map(run => {
          const image = run.images.find(i => i.task_id === run.best_task_id && i.files.length) ?? run.images.find(i => i.files.length);
          return (
            <li key={run.id}>
              <button className={'history-item' + (run.id === activeRun ? ' selected' : '')} onClick={() => onSelect(run.id)}>
                {image ? <img src={fileUrl(image.files[0])} alt="" /> : <span className="placeholder" />}
                <span>{run.mode === 'edit' ? 'Edição' : 'Criação'} · {RUN_STATUS[run.status] ?? run.status}</span>
                <span className="muted small">{new Date(run.created_at * 1000).toLocaleString('pt-BR')}</span>
              </button>
            </li>
          );
        })}
        {!runs.length && !error && <li className="muted">Os pedidos aparecem aqui.</li>}
      </ul>
    </section>
  );
}
