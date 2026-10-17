import {useEffect, useState} from 'react';
import {api, fileUrl} from '../api/client';
import type {Run, Task} from '../api/types';
import {wordDiff} from '../lib/diff';
import {KIND, PHASE, RUN_STATUS, TASK_STATUS, TERMINAL, VERDICT} from '../lib/labels';
import {Icon} from './Icon';

interface Props {
  run: Run; connection: string; onClose: () => void; onReuse: (hash: string) => void; onRepeat: (sameSeed: boolean) => Promise<void>;
  onStop: () => void; onStep: (delta: number) => void; canStep: {prev: boolean; next: boolean}; notify: (m: string, e?: boolean) => void;
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
const when = (s: number) => new Date(s * 1000).toLocaleString('pt-BR', {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'});

export function Viewer({run, connection, onClose, onReuse, onRepeat, onStop, onStep, canStep}: Props) {
  const active = !TERMINAL.has(run.status);
  const now = useNow(active);
  const [selected, setSelected] = useState(0);
  const [zoom, setZoom] = useState(false);
  const [compare, setCompare] = useState(false);
  const [split, setSplit] = useState(50);
  const [repeating, setRepeating] = useState(false);
  const images = run.images.filter(i => i.files.length);
  const bestIndex = Math.max(0, images.findIndex(i => i.task_id === run.best_task_id));
  useEffect(() => {setSelected(bestIndex); setCompare(false); setZoom(false);}, [run.id, bestIndex]);
  const current = images[Math.min(selected, images.length - 1)] ?? null;
  const originalHash = run.files?.references && run.request?.target_id ? run.files.references[run.request.target_id] : null;
  const canCompare = !!current && !!originalHash && run.mode === 'edit';
  const checks = Object.fromEntries((run.settings.checks ?? []).map(c => [c.id, c.question]));
  const repeat = async (same: boolean) => {setRepeating(true); try {await onRepeat(same);} finally {setRepeating(false);}};

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.closest('input, textarea, select')) return;
      if (event.key === 'Escape') {event.stopPropagation(); onClose();}
      else if (event.key === 'ArrowLeft') onStep(-1);
      else if (event.key === 'ArrowRight') onStep(1);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose, onStep]);

  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label="Detalhes do pedido">
      <div className="viewer-stage">
        <div className="viewer-top">
          <button className="icon-btn on-dark" onClick={onClose} aria-label="Fechar"><Icon name="close" size={18} /></button>
          <div className="viewer-tools">
            <button className="icon-btn on-dark" aria-pressed={zoom} disabled={!current} onClick={() => setZoom(z => !z)}
                    aria-label={zoom ? 'Ajustar à tela' : 'Tamanho real'} title={zoom ? 'Ajustar à tela' : 'Tamanho real'}>
              <Icon name={zoom ? 'fit' : 'zoom'} size={17} /></button>
            {canCompare && <button className="icon-btn on-dark" aria-pressed={compare} onClick={() => setCompare(c => !c)}
                    aria-label="Comparar com a original" title="Comparar com a original"><Icon name="compare" size={17} /></button>}
          </div>
        </div>
        <button className="viewer-nav prev" disabled={!canStep.prev} onClick={() => onStep(-1)} aria-label="Pedido anterior"><Icon name="arrowLeft" size={22} /></button>
        <button className="viewer-nav next" disabled={!canStep.next} onClick={() => onStep(1)} aria-label="Próximo pedido"><Icon name="arrowRight" size={22} /></button>
        <div className={'viewer-image' + (zoom ? ' actual' : '')}>
          {current && compare && canCompare ? (
            <div className="compare" style={{['--split' as string]: `${split}%`}}>
              <img src={fileUrl(current.files[0])} alt="Resultado" />
              <img className="before" src={fileUrl(originalHash!)} alt="Original" />
              <span className="compare-label left">Original</span><span className="compare-label right">Resultado</span>
              <input type="range" min={0} max={100} value={split} aria-label="Comparar antes e depois" onChange={e => setSplit(Number(e.target.value))} />
            </div>
          ) : current ? <img src={fileUrl(current.files[0])} alt={`Variação ${current.position + 1}`} />
            : <div className="viewer-waiting">{active && <span className="spinner big" aria-hidden="true" />}
                <p>{active ? RUN_STATUS[run.status] ?? 'Gerando…' : run.error ? 'Este pedido não gerou imagem.' : RUN_STATUS[run.status]}</p></div>}
        </div>
        {images.length > 1 && (
          <div className="viewer-strip" role="listbox" aria-label="Variações">
            {images.map((image, index) => (
              <button key={image.task_id} role="option" aria-selected={index === selected}
                      className={index === selected ? 'selected' : ''} onClick={() => setSelected(index)} title={`seed ${image.seed}`}>
                <img src={fileUrl(image.files[0])} alt={`Variação ${index + 1}`} />
                {image.task_id === run.best_task_id && <span className="best" title="Melhor avaliada"><Icon name="star" size={10} /></span>}
                {image.score != null && <span className="score">{Math.round(image.score * 100)}%</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      <aside className="viewer-side">
        <header>
          <span className={'status ' + run.status}>{RUN_STATUS[run.status] ?? run.status}</span>
          {connection === 'offline' && <span className="status failed">Sem conexão · tentando de novo</span>}
          <h2>{run.mode === 'edit' ? 'Edição de foto' : 'Nova imagem'}</h2>
          <p className="muted">{when(run.created_at)}</p>
        </header>

        <div className="viewer-actions">
          {active ? (
            <button className="btn-stop wide" disabled={run.cancel_requested} onClick={onStop}><Icon name="stop" size={13} />
              {run.cancel_requested ? 'Parando…' : 'Parar'}</button>
          ) : <>
            <button className="btn-primary wide" disabled={repeating} onClick={() => repeat(false)} title="Mesmo pedido, nova seed">
              <Icon name="refresh" size={15} />{repeating ? 'Enviando…' : 'Gerar de novo'}</button>
            <button className="btn-secondary wide" disabled={repeating} onClick={() => repeat(true)} title={`Mesma seed (${run.settings.seed})`}>
              Repetir com a mesma seed</button>
          </>}
          {current && <div className="action-pair">
            <button className="btn-secondary" onClick={() => onReuse(current.files[0])}><Icon name="edit" size={15} />Editar esta imagem</button>
            <a className="btn-secondary" href={fileUrl(current.files[0])} download={`prisma-${current.seed}.png`}><Icon name="download" size={15} />Baixar</a>
          </div>}
        </div>

        {run.error && <p className="note bad">{run.error}</p>}
        {run.cancel_requested && active && <p className="note">Parada solicitada. Aguardando a confirmação do ComfyUI.</p>}
        {(active || run.error) && <TaskList tasks={run.tasks ?? []} now={now} />}

        <dl className="facts">
          <div><dt>Seed</dt><dd>{current?.seed ?? run.settings.seed}</dd></div>
          <div><dt>Qualidade</dt><dd>{run.settings.profile === 'turbo' ? 'Turbo' : 'Máxima'}</dd></div>
          <div><dt>Resolução</dt><dd>{run.settings.width ? `${run.settings.width}×${run.settings.height}` : run.settings.resolution || 'da foto'}</dd></div>
          <div><dt>Imagens</dt><dd>{run.settings.variations}</dd></div>
          {current?.score != null && <div><dt>Verificação</dt><dd>{Math.round(current.score * 100)}%</dd></div>}
        </dl>

        {current?.verdicts && (
          <section className="side-block">
            <h3>Verificação por requisito</h3>
            <ul className="verdicts">{Object.entries(current.verdicts).map(([id, v]) => (
              <li key={id} className={v.verdict}><strong>{VERDICT[v.verdict]}</strong><span>{checks[id] ?? id}{v.note ? ` — ${v.note}` : ''}</span></li>
            ))}</ul>
            <p className="help">Avaliado pelo modelo local, que também pode errar.</p>
          </section>
        )}
        {run.effective_prompt && (
          <section className="side-block">
            <h3>Prompt enviado <button className="btn-link" onClick={() => navigator.clipboard.writeText(run.effective_prompt ?? '')}>Copiar</button></h3>
            <pre>{run.effective_prompt}</pre>
          </section>
        )}
      </aside>
    </div>
  );
}

function TaskList({tasks, now}: {tasks: Task[]; now: number}) {
  if (!tasks.length) return <p className="muted">Preparando o pedido…</p>;
  return (
    <ol className="tasks">
      {tasks.map(task => {
        const live = task.live;
        const elapsed = task.started_at ? (task.ended_at ?? now) - task.started_at : null;
        const phases = task.timings?.phases;
        return (
          <li key={task.id} className={'task ' + task.status}>
            <div className="task-line">
              <span className="task-name">{KIND[task.kind] ?? task.kind}{task.kind !== 'refine' ? ` ${task.position + 1}` : ''}</span>
              <span className="muted">{live?.phase ? PHASE[live.phase] ?? live.phase : TASK_STATUS[task.status] ?? task.status}
                {live?.value != null && live.maximum ? ` · ${live.value}/${live.maximum}` : ''}</span>
              {elapsed != null && <span className="muted num">{seconds(Math.max(0, elapsed))}</span>}
            </div>
            {live?.value != null && live.maximum ? <progress max={live.maximum} value={live.value} /> : null}
            {phases && <span className="muted small">{Object.entries(phases).map(([p, s]) => `${PHASE[p] ?? p}: ${seconds(s)}`).join(' · ')}</span>}
            {task.error && <span className="note bad">{task.error}</span>}
          </li>
        );
      })}
    </ol>
  );
}

export function ReviewDialog({run, notify}: {run: Run; notify: (m: string, e?: boolean) => void}) {
  const [sending, setSending] = useState(false);
  const refineEvent = [...(run.events ?? [])].reverse().find(e => e.type === 'refine_checked') as
    {problems?: {code: string; message: string}[]} | undefined;
  const choose = async (choice: 'refined' | 'original') => {
    setSending(true);
    try {await api.review(run.id, choice);} catch (error) {notify((error as Error).message, true);} finally {setSending(false);}
  };
  return (
    <div className="scrim">
      <div className="sheet dialog" role="dialog" aria-modal="true" aria-labelledby="review-title">
        <h2 id="review-title">Revise o prompt aprimorado</h2>
        <p className="muted">O aprimorador reescreveu o pedido. Em verde o que entrou, riscado o que saiu.</p>
        {refineEvent?.problems?.length ? refineEvent.problems.map(p => <p key={p.code} className="note bad">{p.message}</p>) : null}
        {run.refined_prompt ? <p className="diff">{wordDiff(run.prompt ?? '', run.refined_prompt).map((piece, i) =>
          <span key={i} className={piece.type}>{piece.text}</span>)}</p>
          : <p className="note warn">O aprimorador não devolveu texto. Você pode seguir com o prompt original.</p>}
        <div className="dialog-actions">
          <button className="btn-secondary" disabled={sending} onClick={() => choose('original')}>Usar o original</button>
          {run.refined_prompt && <button className="btn-primary" disabled={sending} onClick={() => choose('refined')}>Usar o aprimorado</button>}
        </div>
      </div>
    </div>
  );
}
