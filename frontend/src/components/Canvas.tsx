import {useEffect, useState} from 'react';
import {api, fileUrl} from '../api/client';
import type {Run, Task} from '../api/types';
import {wordDiff} from '../lib/diff';
import {KIND, PHASE, RUN_STATUS, TASK_STATUS, TERMINAL, VERDICT} from '../lib/labels';
import {Icon} from './Icon';

interface Props {
  run: Run | null; connection: string; targetHash: string | null; mode: 'generate' | 'edit';
  onReuse: (hash: string) => void; onRepeat: (sameSeed: boolean) => Promise<void>; notify: (m: string, e?: boolean) => void;
}

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now() / 1000);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

const seconds = (value: number) => value < 60 ? `${value.toFixed(value < 10 ? 1 : 0)} s` : `${Math.floor(value / 60)} min ${Math.round(value % 60)} s`;

export function Canvas({run, connection, targetHash, mode, onReuse, onRepeat, notify}: Props) {
  const active = !!run && !TERMINAL.has(run.status);
  const now = useNow(active);
  const [selected, setSelected] = useState(0);
  const [zoom, setZoom] = useState<'fit' | 'actual'>('fit');
  const [compare, setCompare] = useState(false);
  const [split, setSplit] = useState(50);
  const [repeating, setRepeating] = useState(false);
  useEffect(() => {setSelected(0); setCompare(false);}, [run?.id]);

  const images = (run?.images ?? []).filter(i => i.files.length);
  const bestIndex = Math.max(0, images.findIndex(i => i.task_id === run?.best_task_id));
  const current = images[Math.min(selected, images.length - 1)] ?? null;
  useEffect(() => {setSelected(bestIndex);}, [bestIndex, run?.id]);
  const originalHash = run?.files?.references && run.request?.target_id ? run.files.references[run.request.target_id] : null;
  const canCompare = !!current && !!originalHash && run?.mode === 'edit';
  const checks = Object.fromEntries((run?.settings.checks ?? []).map(c => [c.id, c.question]));
  const repeat = async (same: boolean) => {setRepeating(true); try {await onRepeat(same);} finally {setRepeating(false);}};
  const review = run?.status === 'review';
  const refineEvent = [...(run?.events ?? [])].reverse().find(e => e.type === 'refine_checked') as
    {problems?: {code: string; message: string}[]} | undefined;
  const choose = async (choice: 'refined' | 'original') => {
    try {await api.review(run!.id, choice);} catch (error) {notify((error as Error).message, true);}
  };

  return (
    <section className="canvas" aria-label="Tela de resultado" aria-live="polite">
      <header className="canvas-toolbar">
        <div className="canvas-title">
          {run ? <><span className={'status-pill ' + run.status}>{RUN_STATUS[run.status] ?? run.status}</span>
            <span className="muted small">{run.mode === 'edit' ? 'Edição' : 'Criação'} · seed {current?.seed ?? run.settings.seed}
              {current?.score != null ? ` · verificação ${Math.round(current.score * 100)}%` : ''}</span></>
            : <span className="muted small">{mode === 'edit' ? 'Foto alvo' : 'Nova imagem'}</span>}
          {connection === 'offline' && <span className="status-pill failed">sem conexão · tentando de novo</span>}
        </div>
        <div className="tool-group">
          <button className="icon-button" aria-pressed={zoom === 'actual'} title={zoom === 'fit' ? 'Tamanho real' : 'Ajustar à tela'}
                  disabled={!current} onClick={() => setZoom(z => z === 'fit' ? 'actual' : 'fit')}>
            <Icon name={zoom === 'fit' ? 'zoom' : 'fit'} /></button>
          <button className="icon-button" aria-pressed={compare} title="Comparar com a original" disabled={!canCompare}
                  onClick={() => setCompare(c => !c)}><Icon name="compare" /></button>
          {current && <a className="icon-button" href={fileUrl(current.files[0])} download={`prisma-${current.seed}.png`} title="Baixar"><Icon name="download" /></a>}
          {current && <button className="icon-button" title="Editar este resultado" onClick={() => onReuse(current.files[0])}><Icon name="edit" /></button>}
          {run && !active && <>
            <span className="tool-divider" />
            <button className="tool-text" disabled={repeating} title="Mesmo pedido, nova seed" onClick={() => repeat(false)}>
              {repeating ? 'Enviando…' : '↻ Gerar de novo'}</button>
            <button className="tool-text quiet" disabled={repeating} title={`Mesmo pedido e mesma seed (${run.settings.seed})`}
                    onClick={() => repeat(true)}>Repetir com a mesma seed</button>
          </>}
        </div>
      </header>

      <div className={'stage' + (zoom === 'actual' ? ' actual' : '')}>
        {current && compare && canCompare ? (
          <div className="compare" style={{['--split' as string]: `${split}%`}}>
            <img src={fileUrl(current.files[0])} alt="Resultado" />
            <img className="before" src={fileUrl(originalHash!)} alt="Original" />
            <span className="compare-label left">Original</span><span className="compare-label right">Resultado</span>
            <input type="range" min={0} max={100} value={split} aria-label="Comparar antes e depois" onChange={e => setSplit(Number(e.target.value))} />
          </div>
        ) : current ? (
          <img className="stage-image" src={fileUrl(current.files[0])} alt={`Variação ${current.position + 1}`} />
        ) : targetHash && !active ? (
          <figure className="stage-empty with-image"><img src={fileUrl(targetHash)} alt="Foto alvo" /><figcaption>Foto alvo · pronta para editar</figcaption></figure>
        ) : (
          <div className="stage-empty">
            <span className="prism" aria-hidden="true" />
            <p>{active ? 'Gerando…' : 'Sua imagem aparece aqui'}</p>
            <span className="muted small">{active ? '' : 'Configure a cena no inspetor e clique em Gerar.'}</span>
          </div>
        )}
        {run && (active || run.error) && (
          <div className="overlay-card progress-card">
            {run.error && <p className="issue error">{run.error}</p>}
            {run.cancel_requested && active && <p className="help">Parada solicitada. Aguardando a confirmação do ComfyUI.</p>}
            <TaskList tasks={run.tasks ?? []} now={now} />
          </div>
        )}
        {review && run && (
          <div className="overlay-card review">
            <h3>Revise o aprimoramento</h3>
            {refineEvent?.problems?.length ? <ul className="issues">{refineEvent.problems.map(p => <li key={p.code} className="issue error">{p.message}</li>)}</ul>
              : run.refined_prompt ? <p className="help">Nenhum problema objetivo encontrado. Confira as diferenças antes de usar.</p> : null}
            {run.refined_prompt ? <p className="diff">{wordDiff(run.prompt ?? '', run.refined_prompt).map((piece, i) =>
              <span key={i} className={piece.type}>{piece.text}</span>)}</p>
              : <p className="issue warning">O aprimorador não devolveu texto. Você pode seguir com o prompt original.</p>}
            <div className="row">
              <button className="secondary" onClick={() => choose('original')}>Usar o original</button>
              {run.refined_prompt && <button className="primary" onClick={() => choose('refined')}>Usar o aprimorado</button>}
            </div>
          </div>
        )}
      </div>

      {(images.length > 1 || current?.verdicts || run?.effective_prompt) && (
        <footer className="canvas-footer">
          {images.length > 1 && (
            <div className="variations" role="listbox" aria-label="Variações">
              {images.map((image, index) => (
                <button key={image.task_id} role="option" aria-selected={index === selected}
                        className={'variation' + (index === selected ? ' selected' : '') + (image.task_id === run?.best_task_id ? ' best' : '')}
                        onClick={() => setSelected(index)} title={`seed ${image.seed}`}>
                  <img src={fileUrl(image.files[0])} alt={`Variação ${index + 1}`} />
                  {image.score != null && <span className="score">{Math.round(image.score * 100)}%</span>}
                </button>
              ))}
            </div>
          )}
          <div className="canvas-details">
            {current?.verdicts && (
              <details>
                <summary>Verificação por requisito</summary>
                <ul className="verdicts">{Object.entries(current.verdicts).map(([id, v]) => (
                  <li key={id} className={v.verdict}><strong>{VERDICT[v.verdict]}</strong> · {checks[id] ?? id}{v.note ? ` — ${v.note}` : ''}</li>
                ))}</ul>
                <p className="help">Avaliado pelo modelo local, que também pode errar.</p>
              </details>
            )}
            {run?.effective_prompt && <details><summary>Prompt efetivamente enviado</summary><pre>{run.effective_prompt}</pre></details>}
          </div>
        </footer>
      )}
    </section>
  );
}

function TaskList({tasks, now}: {tasks: Task[]; now: number}) {
  if (!tasks.length) return <p className="muted small">Preparando o pedido…</p>;
  return (
    <ol className="tasks">
      {tasks.map(task => {
        const live = task.live;
        const elapsed = task.started_at ? (task.ended_at ?? now) - task.started_at : null;
        const phases = task.timings?.phases;
        return (
          <li key={task.id} className={'task ' + task.status}>
            <span className="task-name">{KIND[task.kind] ?? task.kind}{task.kind !== 'refine' ? ` ${task.position + 1}` : ''}</span>
            <span className="muted">{live?.phase ? PHASE[live.phase] ?? live.phase : TASK_STATUS[task.status] ?? task.status}
              {live?.value != null && live.maximum ? ` · passo ${live.value}/${live.maximum}` : ''}</span>
            {elapsed != null && <span className="muted mono">{seconds(Math.max(0, elapsed))}</span>}
            {live?.value != null && live.maximum ? <progress max={live.maximum} value={live.value} /> : null}
            {phases && <span className="muted small phases">{Object.entries(phases).map(([p, s]) => `${PHASE[p] ?? p}: ${seconds(s)}`).join(' · ')}</span>}
            {task.error && <span className="issue error">{task.error}</span>}
          </li>
        );
      })}
    </ol>
  );
}
