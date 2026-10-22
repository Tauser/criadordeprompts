import {useEffect, useRef, useState} from 'react';
import type {Run} from '../api/types';
import {TERMINAL} from './labels';
import {load, save} from './storage';

// Tells the person when the run being followed has finished: the tab title, a system notification (only when
// the page is hidden) and a short beep. Runs that were already finished when they were first seen stay silent.
const KEY = 'prisma.finish-notice.v1';
const BASE_TITLE = 'Prisma Studio';
const TITLES = {ok: '✓ Pronto · Prisma Studio', failed: '✗ Falhou · Prisma Studio'} as const;
const BODIES = {ok: 'Imagem pronta', failed: 'A geração falhou'} as const;
const INSECURE = 'Neste endereço o navegador não permite notificações; o título da aba e o som continuam funcionando.';
const UNSUPPORTED = 'Este navegador não oferece notificações; o título da aba e o som continuam funcionando.';
const DENIED = 'Notificações bloqueadas neste navegador. Libere-as nas configurações do site para receber o aviso.';

export interface Choices {system: boolean; sound: boolean}
type Outcome = keyof typeof TITLES;

const readChoices = (): Choices => {
  const value = load<Partial<Choices> | null>(KEY, null) ?? {};
  return {system: value.system === true, sound: value.sound === true};
};

// Why system notifications cannot be used here, or null when they can.
export function notificationReason(refused = false): string | null {
  if (!('Notification' in globalThis)) return UNSUPPORTED;
  if (globalThis.isSecureContext === false) return INSECURE;
  if (refused || Notification.permission === 'denied') return DENIED;
  return null;
}

const granted = () => 'Notification' in globalThis && Notification.permission === 'granted';

// A short beep made with Web Audio: no audio file, and silent where the browser has no audio context.
function beep() {
  try {
    const Context = globalThis.AudioContext ?? (globalThis as unknown as {webkitAudioContext?: typeof AudioContext}).webkitAudioContext;
    if (!Context) return;
    const context = new Context();
    const oscillator = context.createOscillator(), gain = context.createGain();
    oscillator.frequency.value = 880; gain.gain.value = 0.15;
    oscillator.connect(gain); gain.connect(context.destination);
    oscillator.onended = () => void context.close();
    oscillator.start(); oscillator.stop(context.currentTime + 0.15);
  } catch {
    /* the sound is optional */
  }
}

export function useFinishNotice(run: Run | null) {
  const [choices, setChoices] = useState<Choices>(readChoices);
  const [refused, setRefused] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const current = useRef(choices);
  current.current = choices;
  const seen = useRef<{id: string; terminal: boolean} | null>(null);

  // A run is announced only when this page saw it active and then terminal, never when it was already finished.
  useEffect(() => {
    if (!run) return;
    const before = seen.current;
    const terminal = TERMINAL.has(run.status);
    seen.current = {id: run.id, terminal};
    if (!terminal || !before || before.id !== run.id || before.terminal) return;
    if (run.status === 'cancelled') return;             // the person stopped it: no need to announce
    const result: Outcome = run.status === 'completed' ? 'ok' : 'failed';
    setOutcome(result);
    if (current.current.sound) beep();
    if (current.current.system && document.visibilityState === 'hidden' && granted()) {
      try {
        const note = new Notification('Prisma Studio', {body: BODIES[result], tag: 'prisma-studio-run'});
        note.onclick = () => {window.focus(); note.close();};
      } catch {
        /* the browser refused to show it: the title and the sound still tell */
      }
    }
  }, [run]);

  // The title stays marked until the page is looked at again.
  useEffect(() => {
    if (!outcome) return;
    document.title = TITLES[outcome];
    const back = () => {if (document.visibilityState === 'visible') setOutcome(null);};
    const focused = () => setOutcome(null);
    document.addEventListener('visibilitychange', back);
    window.addEventListener('focus', focused);
    return () => {
      document.removeEventListener('visibilitychange', back);
      window.removeEventListener('focus', focused);
      document.title = BASE_TITLE;
    };
  }, [outcome]);

  const update = (next: Choices) => {
    setChoices(next);
    save(KEY, next);
  };

  const setSound = (on: boolean) => update({...current.current, sound: on});
  const setSystem = async (on: boolean) => {
    if (!on) {update({...current.current, system: false}); return;}
    if (notificationReason() !== null) return;
    let permission: NotificationPermission = 'denied';
    try {permission = await Notification.requestPermission();} catch {/* treated as refused */}
    setRefused(permission !== 'granted');
    update({...current.current, system: permission === 'granted'});
  };

  const reason = notificationReason(refused);
  return {system: choices.system && reason === null && granted(), sound: choices.sound, reason, setSystem, setSound};
}
