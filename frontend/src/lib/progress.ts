import type {Run, Task} from '../api/types';
import {PHASE, TERMINAL} from './labels';

// The stages a run goes through, as the person reads them. Only the stages this run actually has are listed:
// no refine task, no "Aprimorando"; no verify task, no "Verificação".
export type StepState = 'done' | 'now' | 'todo' | 'failed';
export interface Step {id: string; label: string; state: StepState; fraction: number | null}
export interface Progress {steps: Step[]; label: string; detail: string; fraction: number; elapsed: number}

const OPEN = new Set(['submitting', 'queued', 'running', 'uncertain']);
const KINDS: Record<string, string[]> = {refine: ['refine'], image: ['image'], faces: ['face_detect', 'face'], verify: ['verify']};
const STATUS_STEP: Record<string, string> = {created: 'prepare', preparing: 'prepare', refining: 'refine', review: 'refine',
  generating: 'image', detailing: 'faces', verifying: 'verify'};

const live = (task: Task) => task.live?.value != null && task.live.maximum ? task.live.value / task.live.maximum : null;

export const formatSeconds = (value: number) => value < 60 ? `${Math.round(value)} s`
  : value < 3600 ? `${Math.floor(value / 60)} min ${String(Math.floor(value % 60)).padStart(2, '0')} s`
  : `${Math.floor(value / 3600)} h ${String(Math.floor(value % 3600 / 60)).padStart(2, '0')} min`;

export function runProgress(run: Run, now: number): Progress {
  const tasks = run.tasks ?? [];
  const of = (id: string) => tasks.filter(t => KINDS[id].includes(t.kind));
  const finished = TERMINAL.has(run.status);
  const current = STATUS_STEP[run.status];
  const steps: Step[] = [];
  const started = tasks.some(t => t.started_at || t.status !== 'created');
  steps.push({id: 'prepare', label: 'Preparando', fraction: null,
    state: current === 'prepare' && !started ? 'now' : 'done'});
  const add = (id: string, label: string, wanted: boolean) => {
    const own = of(id);
    if (!own.length && !wanted) return;
    const done = own.length > 0 && own.every(t => t.status === 'completed');
    const failed = own.some(t => ['failed', 'lost'].includes(t.status));
    const active = current === id || own.some(t => OPEN.has(t.status));
    const parts = own.map(t => t.status === 'completed' ? 1 : live(t) ?? 0);
    const fraction = own.length ? parts.reduce((a, b) => a + b, 0) / own.length : null;
    steps.push({id, label, fraction, state: failed ? 'failed' : done ? 'done' : active && !finished ? 'now' : 'todo'});
  };
  add('refine', 'Aprimorando', run.settings.refine);
  add('image', 'Gerando', true);
  add('faces', 'Rostos', run.settings.face_detail === true);
  add('verify', 'Verificação', run.settings.verify);

  const nowStep = steps.find(s => s.state === 'now');
  const running = tasks.find(t => t.status === 'running') ?? tasks.find(t => OPEN.has(t.status));
  const phase = running?.live?.phase ? PHASE[running.live.phase] ?? running.live.phase : '';
  const step = running?.live?.value != null && running.live.maximum ? `passo ${running.live.value}/${running.live.maximum}` : '';
  const images = of('image');
  const variation = images.length > 1 && running?.kind === 'image' ? `variação ${running.position + 1} de ${images.length}` : '';
  const doneCount = steps.filter(s => s.state === 'done').length;
  const fraction = finished ? 1 : (doneCount + (nowStep?.fraction ?? 0)) / steps.length;
  const end = finished ? run.updated_at : now;
  return {steps, label: phase, detail: [variation, step].filter(Boolean).join(' · '), fraction,
    elapsed: Math.max(0, end - run.created_at)};
}
