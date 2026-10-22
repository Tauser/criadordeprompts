// @vitest-environment happy-dom
import {act, cleanup, render, renderHook, screen} from '@testing-library/react';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import type {Run} from '../api/types';
import {useFinishNotice} from '../lib/finishNotice';
import {FinishNotice} from './FinishNotice';

const KEY = 'prisma.finish-notice.v1';
const run = (status: string) => ({id: 'r1', status, images: []} as unknown as Run);
const INSECURE = 'Neste endereço o navegador não permite notificações; o título da aba e o som continuam funcionando.';

class FakeNotification {
  static permission: NotificationPermission = 'default';
  static requestPermission = vi.fn(async () => FakeNotification.permission);
  static shown: [string, NotificationOptions | undefined][] = [];
  onclick: (() => void) | null = null;
  close = vi.fn();
  constructor(title: string, options?: NotificationOptions) {FakeNotification.shown.push([title, options]);}
}

let visibility: DocumentVisibilityState = 'visible';
const changeVisibility = (state: DocumentVisibilityState) => {
  visibility = state;
  act(() => {document.dispatchEvent(new Event('visibilitychange'));});
};

beforeEach(() => {
  localStorage.clear();
  FakeNotification.permission = 'default';
  FakeNotification.shown = [];
  FakeNotification.requestPermission.mockClear();
  vi.stubGlobal('Notification', FakeNotification);
  vi.stubGlobal('isSecureContext', true);
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => visibility});
  document.title = 'Prisma Studio';
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (document as unknown as {visibilityState?: string}).visibilityState;
  document.title = 'Prisma Studio';
  localStorage.clear();
});

function Harness({current}: {current: Run | null}) {
  return <FinishNotice finish={useFinishNotice(current)} />;
}

it('marca o título ao terminar e volta ao normal quando a página volta a ser vista', () => {
  const {rerender} = renderHook(({r}) => useFinishNotice(r), {initialProps: {r: run('generating') as Run | null}});
  rerender({r: run('completed')});
  expect(document.title).toBe('✓ Pronto · Prisma Studio');
  changeVisibility('hidden');
  expect(document.title).toBe('✓ Pronto · Prisma Studio');
  changeVisibility('visible');
  expect(document.title).toBe('Prisma Studio');
});

it('marca falha no título', () => {
  const {rerender} = renderHook(({r}) => useFinishNotice(r), {initialProps: {r: run('generating') as Run | null}});
  rerender({r: run('failed')});
  expect(document.title).toBe('✗ Falhou · Prisma Studio');
});

it('não envia notificação sem permissão, mesmo com a opção salva', () => {
  localStorage.setItem(KEY, JSON.stringify({system: true, sound: false}));
  const {rerender} = renderHook(({r}) => useFinishNotice(r), {initialProps: {r: run('generating') as Run | null}});
  visibility = 'hidden';
  rerender({r: run('completed')});
  expect(FakeNotification.shown).toHaveLength(0);
});

it('envia a notificação só com a página oculta e a permissão concedida', async () => {
  FakeNotification.permission = 'granted';
  const {result, rerender} = renderHook(({r}) => useFinishNotice(r), {initialProps: {r: run('generating') as Run | null}});
  await act(async () => {await result.current.setSystem(true);});
  expect(result.current.system).toBe(true);
  rerender({r: run('completed')});
  expect(FakeNotification.shown).toHaveLength(0);          // página visível: só o título
});

it('mostra a notificação com a página oculta', async () => {
  FakeNotification.permission = 'granted';
  const {result, rerender} = renderHook(({r}) => useFinishNotice(r), {initialProps: {r: run('generating') as Run | null}});
  await act(async () => {await result.current.setSystem(true);});
  visibility = 'hidden';
  rerender({r: run('completed')});
  expect(FakeNotification.shown).toEqual([['Prisma Studio', {body: 'Imagem pronta', tag: 'prisma-studio-run'}]]);
});

it('pede a permissão ao ligar e fica desligada se o usuário recusar', async () => {
  FakeNotification.permission = 'default';
  FakeNotification.requestPermission.mockResolvedValueOnce('denied');
  const {result} = renderHook(() => useFinishNotice(null));
  await act(async () => {await result.current.setSystem(true);});
  expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1);
  expect(result.current.system).toBe(false);
  expect(JSON.parse(localStorage.getItem(KEY) ?? '{}').system).toBe(false);
});

it('explica no endereço http que notificações não funcionam e mantém a opção desligada', () => {
  vi.stubGlobal('isSecureContext', false);
  render(<Harness current={null} />);
  expect(screen.getByText(INSECURE)).toBeTruthy();
  const system = screen.getByRole('checkbox', {name: /Notificação do sistema/}) as HTMLInputElement;
  expect(system.checked).toBe(false);
  expect(system.disabled).toBe(true);
  expect(screen.getByRole('checkbox', {name: /Som/})).toBeTruthy();
});

it('não avisa uma execução que já estava concluída ao abrir a página', () => {
  FakeNotification.permission = 'granted';
  localStorage.setItem(KEY, JSON.stringify({system: true, sound: false}));
  const {result} = renderHook(({r}) => useFinishNotice(r), {initialProps: {r: run('completed') as Run | null}});
  visibility = 'hidden';
  expect(document.title).toBe('Prisma Studio');
  expect(FakeNotification.shown).toHaveLength(0);
  expect(result.current.system).toBe(true);
});

it('guarda a escolha do som no localStorage', async () => {
  const {result} = renderHook(() => useFinishNotice(null));
  act(() => result.current.setSound(true));
  expect(result.current.sound).toBe(true);
  expect(JSON.parse(localStorage.getItem(KEY) ?? '{}').sound).toBe(true);
});
