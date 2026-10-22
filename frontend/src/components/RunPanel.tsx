import {useEffect, useState} from 'react';
import {api, fileUrl} from '../api/client';
import type {Item, Run, Task} from '../api/types';
import {wordDiff} from '../lib/diff';
import {KIND, PHASE, RUN_STATUS, TASK_STATUS, TERMINAL, VERDICT} from '../lib/labels';
import {formatSeconds, runProgress} from '../lib/progress';
import {relativeTime} from '../lib/time';
import {ComparePicker, type ComparePlan} from './CompareGrid';
import {Icon} from './Icon';

interface Props {run: Run | null; connection: string; onReuse: (hash: string, options?: {mask: boolean}) => void; notify: (m: string, e?: boolean) => void;
  onRepeat: (sameSeed: boolean, redo?: {profile: 'qwen21' | 'turbo'; seed: number}) => Promise<void>;
  items?: Item[]; onCompare?: (plan: ComparePlan) => Promise<void>}

export function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now() / 1000);
  useEffect(() => {
    if (!active) return;
    setNow(Date.now() / 1000);
    const timer = window.setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

// People seen in a picture: by face or, when the body detector ran, by whole body; a hidden face counts no one.
const counted = (detail?: {found: number; people?: number | null} | null) => Math.max(detail?.found ?? 0, detail?.people ?? 0);

const seconds = (value: number) => value < 60 ? `${value.toFixed(value < 10 ? 1 : 0)} s` : `${Math.floor(value / 60)} min ${Math.round(value % 60)} s`;

// The stage: the result first, then what to do with it; progress while the run works; technical detail folded away.
export function RunPanel({run, connection, onReuse, notify, onRepeat, items = [], onCompare}: Props) {
  const [repeating, setRepeating] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const [showChecks, setShowChecks] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [sending, setSending] = useState(false);
  const active = !!run && !TERMINAL.has(run.status);
  const now = useNow(active);
  useEffect(() => {setChosen(null); setShowChecks(false); setComparing(false);}, [run?.id]);

  if (!run) return (
    <section className="card run stage-card" aria-labelledby="run-title">
      <div className="section-title"><h2 id="run-title">Resultado</h2></div>
      <div className="stage-empty">
        <Icon name="image" size={28} />
        <p>Seu resultado aparece aqui.</p>
        <p className="muted small">Preencha os campos e gere com <kbd>Ctrl</kbd> + <kbd>Enter</kbd>.</p>
      </div>
    </section>
  );

  const review = run.status === 'review';
  const checks = Object.fromEntries((run.settings.checks ?? []).map(c => [c.id, c.question]));
  const refineEvent = [...(run.events ?? [])].reverse().find(e => e.type === 'refine_checked') as
    {problems?: {code: string; message: string}[]} | undefined;
  const choose = async (choice: 'refined' | 'original') => {
    try {await api.review(run.id, choice);} catch (error) {notify((error as Error).message, true);}
  };
  const images = run.images.filter(image => image.files.length);
  const shown = images.find(i => i.task_id === chosen) ?? images.find(i => i.task_id === run.best_task_id) ?? images[0];
  const progress = runProgress(run, now);
  const verdicts = shown?.verdicts ? Object.entries(shown.verdicts) : [];
  const met = verdicts.filter(([, v]) => v.verdict === 'met').length;
  const extra = shown && counted(shown.detail) > (shown.detail?.expected ?? Infinity) ? shown.detail : null;
  const repeat = async (sameSeed: boolean, redo?: {profile: 'qwen21' | 'turbo'; seed: number}) => {
    setRepeating(true); try {await onRepeat(sameSeed, redo);} finally {setRepeating(false);}
  };
  const settings = [run.settings.profile === 'turbo' ? 'Turbo' : 'Completa',
    run.settings.width ? `${run.settings.width}×${run.settings.height}` : run.settings.resolution ? String(run.settings.resolution) : 'Original',
    `${run.settings.variations} ${run.settings.variations === 1 ? 'variação' : 'variações'}`].join(' · ');

  return (
    <section className="card run stage-card" aria-labelledby="run-title">
      <div className="section-title">
        <h2 id="run-title">{RUN_STATUS[run.status] ?? run.status}</h2>
        <span className="muted small">{active ? settings : `${relativeTime(run.created_at)} · ${formatSeconds(progress.elapsed)}`}</span>
        <span className="spacer" />
        {connection === 'offline' && <span className="badge undetermined">Sem conexão com o Studio · tentando de novo</span>}
        {verdicts.length > 0 && (
          <button type="button" className={'badge ' + (met === verdicts.length ? 'compatible' : 'undetermined')} aria-expanded={showChecks}
                  onClick={() => setShowChecks(s => !s)} title="A verificação é feita pelo modelo local e também pode errar.">
            <Icon name="check" size={12} /> {met} de {verdicts.length} requisitos</button>
        )}
      </div>

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

      {shown ? (
        <figure className="stage">
          <a href={fileUrl(shown.files[0])} target="_blank" rel="noreferrer" title="Abrir em tamanho real">
            <img src={fileUrl(shown.files[0])} alt={`Variação ${shown.position + 1}`} /></a>
          {active && <Steps progress={progress} />}
        </figure>
      ) : active ? (
        <div className="stage stage-pending"><Steps progress={progress} /></div>
      ) : null}

      {extra && <p className="issue warning">Foram encontradas {counted(extra)} pessoas na imagem, e o pedido tem {extra.expected}: confira se apareceu alguém a mais.</p>}

      {showChecks && shown?.verdicts && (
        <ul className="verdicts">{verdicts.map(([id, v]) => (
          <li key={id} className={v.verdict}><strong>{VERDICT[v.verdict]}</strong> · {checks[id] ?? id}{v.note ? ` — ${v.note}` : ''}</li>
        ))}</ul>
      )}

      {images.length > 1 && (
        <div className="variations" role="group" aria-label="Variações">
          {images.map(image => (
            <button key={image.task_id} type="button" aria-pressed={image === shown}
                    className={'variation' + (image === shown ? ' on' : '')} onClick={() => setChosen(image.task_id)}
                    title={`Variação ${image.position + 1} · seed ${image.seed}${image.score != null ? ` · ${Math.round(image.score * 100)}%` : ''}${
                      counted(image.detail) > (image.detail?.expected ?? Infinity) ? ' · pessoa a mais?' : ''}`}>
              <img src={fileUrl(image.files[0])} alt={`Variação ${image.position + 1}`} />
              {run.best_task_id === image.task_id && <span className="best-mark" title="Melhor avaliada"><Icon name="star" size={11} /></span>}
            </button>
          ))}
        </div>
      )}

      {(shown || !active) && (
        <div className="row stage-actions">
          {shown && <>
            <button className="primary" onClick={() => onReuse(shown.files[0])}><Icon name="edit" size={15} />Editar este resultado</button>
            <button className="secondary" title="Edita só uma parte deste resultado: pinte a área e descreva o que muda."
                    onClick={() => onReuse(shown.files[0], {mask: true})}><Icon name="mask" size={15} />Corrigir área</button>
            <a className="button secondary" title={`seed ${shown.seed}`} href={fileUrl(shown.files[0])} download={`prisma-${shown.seed}.png`}><Icon name="download" size={15} />Baixar</a>
          </>}
          <span className="spacer" />
          {!active && shown && run.settings.profile === 'turbo' && (
            <button className="secondary" disabled={repeating} onClick={() => repeat(true, {profile: 'qwen21', seed: shown.seed})}
                    title={run.mode === 'generate'
                      ? 'Refaz esta variação no perfil Completo a partir dela mesma: a pessoa, a roupa e a composição ficam, e entra o detalhe do Completo.'
                      : `Refaz esta edição no perfil Completo com a mesma seed (${shown.seed}); a foto original segura a pessoa e a composição.`}>
              <Icon name="refresh" size={15} />Refazer no Completo</button>)}
          {!active && <>
            <button className="quiet" disabled={repeating} title="Mesmo pedido, nova seed" onClick={() => repeat(false)}>
              <Icon name="refresh" size={15} />{repeating ? 'Enviando…' : 'Nova seed'}</button>
            <button className="quiet" disabled={repeating} title={`Mesmo pedido e mesma seed (${run.settings.seed})`} onClick={() => repeat(true)}>
              Mesma seed</button>
            {onCompare && run.request && run.files && (
              <button className="quiet" aria-expanded={comparing} title="Gera várias imagens lado a lado: seeds, perfil ou opções de uma categoria"
                      onClick={() => setComparing(c => !c)}>Comparar</button>)}
          </>}
        </div>
      )}
      {comparing && onCompare && !active && run.request && run.files && (
        <ComparePicker run={run} items={items} busy={sending} onCancel={() => setComparing(false)}
          onConfirm={async plan => {
            setSending(true);
            try {await onCompare(plan); setComparing(false);} finally {setSending(false);}
          }} />
      )}
      {run.cancel_requested && active && <p className="help">Parada solicitada. Aguardando a confirmação do ComfyUI.</p>}

      <details className="tech">
        <summary>Detalhes técnicos</summary>
        <TaskList tasks={run.tasks ?? []} now={now} />
        <h3 className="small">Prompt efetivamente enviado</h3>
        <pre>{run.effective_prompt}</pre>
      </details>
    </section>
  );
}

function Steps({progress}: {progress: ReturnType<typeof runProgress>}) {
  return (
    <div className="steps-overlay">
      <ol className="steps">
        {progress.steps.map(step => (
          <li key={step.id} className={step.state}>
            <span className="step-bar"><i style={{width: `${Math.round((step.state === 'done' ? 1 : step.state === 'now' ? step.fraction ?? 0 : 0) * 100)}%`}} /></span>
            {step.label}
          </li>
        ))}
      </ol>
      <div className="steps-line"><span>{progress.label || 'Aguardando'}</span>
        {progress.detail && <span className="muted">{progress.detail}</span>}
        <span className="spacer" /><span className="muted num">{formatSeconds(progress.elapsed)}</span></div>
    </div>
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
            {phases && <span className="muted small">{Object.entries(phases).map(([p, s]) => `${PHASE[p] ?? p}: ${seconds(s)}`).join(' · ')}</span>}
            {task.error && <span className="issue error">{task.error}</span>}
          </li>
        );
      })}
    </ol>
  );
}
