import {useEffect, useState} from 'react';
import {api, fileUrl} from '../api/client';
import type {Run, Task} from '../api/types';
import {wordDiff} from '../lib/diff';
import {KIND, PHASE, RUN_STATUS, TASK_STATUS, TERMINAL, VERDICT} from '../lib/labels';
import {useCollapsed} from '../lib/useCollapsed';
import {CollapseButton} from './Collapse';

interface Props {run: Run | null; connection: string; onReuse: (hash: string) => void; notify: (m: string, e?: boolean) => void;
  onRepeat: (sameSeed: boolean) => Promise<void>}

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

export function RunPanel({run, connection, onReuse, notify, onRepeat}: Props) {
  const [repeating, setRepeating] = useState(false);
  const [collapsed, toggle] = useCollapsed('result');
  const active = !!run && !TERMINAL.has(run.status);
  const now = useNow(active);
  if (!run) return (
    <section className={'card collapsible' + (collapsed ? ' is-collapsed' : '')}>
      <div className="section-title"><h2>Resultado</h2><CollapseButton collapsed={collapsed} onToggle={toggle} controls="run-body" label="resultado" /></div>
      {!collapsed && <p id="run-body" className="muted">Nenhum pedido selecionado.</p>}
    </section>
  );
  const review = run.status === 'review';
  const checks = Object.fromEntries((run.settings.checks ?? []).map(c => [c.id, c.question]));
  const refineEvent = [...(run.events ?? [])].reverse().find(e => e.type === 'refine_checked') as
    {problems?: {code: string; message: string}[]} | undefined;
  const choose = async (choice: 'refined' | 'original') => {
    try {await api.review(run.id, choice);} catch (error) {notify((error as Error).message, true);}
  };
  return (
    <section className={'card run collapsible' + (collapsed ? ' is-collapsed' : '')} aria-labelledby="run-title" aria-live="polite">
      <div className="section-title">
        <h2 id="run-title">{RUN_STATUS[run.status] ?? run.status}</h2>
        <span className="muted small">{connection === 'offline' ? 'Sem conexão com o Studio · tentando de novo' : ''}</span>
        {collapsed && <span className="collapsed-summary">{run.images.filter(i => i.files.length).length} {run.images.filter(i => i.files.length).length === 1 ? 'imagem' : 'imagens'}</span>}
        <CollapseButton collapsed={collapsed} onToggle={toggle} controls="run-body" label="resultado" />
      </div>
      {!collapsed && <div id="run-body">
      {run.error && <p className="issue error">{run.error}</p>}
      {(run.tasks ?? []).filter(t => t.status === 'uncertain').map(task => (
        <div key={task.id} className="issue warning" role="alert">
          <p>O Studio não conseguiu confirmar se o ComfyUI recebeu a etapa “{KIND[task.kind] ?? task.kind}”.
            {task.error ? ` ${task.error}` : ''} Ele continua procurando o trabalho e segue sozinho se o encontrar.</p>
          <p className="small">Reenviar agora pode fazer o ComfyUI executar a etapa duas vezes, se o primeiro envio tiver chegado.</p>
          <div className="row">
            <button className="secondary" onClick={async () => {
              if (!confirm('Reenviar esta etapa? Se o primeiro envio chegou ao ComfyUI, ela será executada duas vezes.')) return;
              try {await api.resubmit(run.id, task.id);} catch (error) {notify((error as Error).message, true);}
            }}>Reenviar etapa</button>
          </div>
        </div>
      ))}
      {!active && (
        <div className="row repeat">
          <button className="secondary" disabled={repeating} title="Mesmo pedido, nova seed"
                  onClick={async () => {setRepeating(true); try {await onRepeat(false);} finally {setRepeating(false);}}}>
            {repeating ? 'Enviando…' : '↻ Gerar de novo'}</button>
          <button className="quiet" disabled={repeating} title={`Mesmo pedido e mesma seed (${run.settings.seed})`}
                  onClick={async () => {setRepeating(true); try {await onRepeat(true);} finally {setRepeating(false);}}}>
            Repetir com a mesma seed</button>
        </div>
      )}
      {run.cancel_requested && active && <p className="help">Parada solicitada. Aguardando a confirmação do ComfyUI.</p>}
      <TaskList tasks={run.tasks ?? []} now={now} />
      {review && (
        <div className="review">
          <h3>Revise o aprimoramento</h3>
          {refineEvent?.problems?.length ? <ul className="issues">{refineEvent.problems.map(p => <li key={p.code} className="issue error">{p.message}</li>)}</ul>
            : run.refined_prompt ? <p className="help">Nenhum problema objetivo encontrado. Confira as diferenças antes de usar.</p> : null}
          {run.refined_prompt ? (
            <p className="diff">{wordDiff(run.prompt ?? '', run.refined_prompt).map((piece, i) =>
              <span key={i} className={piece.type}>{piece.text}</span>)}</p>
          ) : <p className="issue warning">O aprimorador não devolveu texto. Você pode seguir com o prompt original.</p>}
          <div className="row">
            <button className="secondary" onClick={() => choose('original')}>Usar o original</button>
            {run.refined_prompt && <button className="primary" onClick={() => choose('refined')}>Usar o aprimorado</button>}
          </div>
        </div>
      )}
      <div className="results">
        {run.images.filter(image => image.files.length).map(image => (
          <article key={image.task_id} className={'result' + (run.best_task_id === image.task_id && run.images.length > 1 ? ' best' : '')}>
            <a href={fileUrl(image.files[0])} target="_blank" rel="noreferrer"><img src={fileUrl(image.files[0])} alt={`Variação ${image.position + 1}`} /></a>
            <div className="row">
              <span className="muted small">seed {image.seed}{image.score != null ? ` · ${Math.round(image.score * 100)}%` : ''}</span>
              <span className="spacer" />
              <a className="button quiet" href={fileUrl(image.files[0])} download={`prisma-${image.seed}.png`}>Baixar</a>
              <button className="quiet" onClick={() => onReuse(image.files[0])}>Editar este resultado</button>
            </div>
            {image.verdicts && (
              <details>
                <summary>Verificação por requisito</summary>
                <ul className="verdicts">{Object.entries(image.verdicts).map(([id, v]) => (
                  <li key={id} className={v.verdict}><strong>{VERDICT[v.verdict]}</strong> · {checks[id] ?? id}{v.note ? ` — ${v.note}` : ''}</li>
                ))}</ul>
                <p className="help">A verificação é feita pelo modelo local e também pode errar.</p>
              </details>
            )}
          </article>
        ))}
      </div>
      <details>
        <summary>Prompt efetivamente enviado</summary>
        <pre>{run.effective_prompt}</pre>
      </details>
      </div>}
    </section>
  );
}

function TaskList({tasks, now}: {tasks: Task[]; now: number}) {
  if (!tasks.length) return null;
  return (
    <ol className="tasks">
      {tasks.map(task => {
        const live = task.live;
        const elapsed = task.started_at ? (task.ended_at ?? now) - task.started_at : null;
        const phases = task.timings?.phases;
        return (
          <li key={task.id} className={'task ' + task.status}>
            <span>{KIND[task.kind] ?? task.kind}{task.kind !== 'refine' ? ` ${task.position + 1}` : ''}</span>
            <span className="muted">{TASK_STATUS[task.status] ?? task.status}</span>
            {live?.phase && <span>{PHASE[live.phase] ?? live.phase}{live.value != null && live.maximum ? ` · passo ${live.value}/${live.maximum}` : ''}</span>}
            {elapsed != null && <span className="muted">{seconds(Math.max(0, elapsed))}</span>}
            {live?.value != null && live.maximum ? <progress max={live.maximum} value={live.value} /> : null}
            {phases && <span className="muted small">{Object.entries(phases).map(([p, s]) => `${PHASE[p] ?? p}: ${seconds(s)}`).join(' · ')}</span>}
            {task.error && <span className="issue error">{task.error}</span>}
          </li>
        );
      })}
    </ol>
  );
}
