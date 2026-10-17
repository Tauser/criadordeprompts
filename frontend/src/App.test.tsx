// @vitest-environment happy-dom
import {act, cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {App} from './App';

const library = {revision: 0, origins: {'environment.garden': 'builtin', 'style.real': 'builtin'}, items: [
  {id: 'environment.garden', category: 'environment', label: 'Jardim natural', prompt: 'a quiet garden', adult: false, enabled: true, requirements: {}, provides: {}},
  {id: 'style.real', category: 'style', label: 'Realista', prompt: 'photorealistic', adult: false, enabled: true, requirements: {}, provides: {}},
]};
let calls: {path: string; body: any}[] = [];
let runStatus = 'generating';

function respond(path: string, init?: RequestInit) {
  const body = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
  calls.push({path, body});
  const json = (data: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(data), {status, headers: {'Content-Type': 'application/json'}}));
  if (path === '/api/library') return json(library);
  if (path === '/api/health') return json({studio_version: '0.1.0', data_dir: 'x', comfy_url: 'y', comfy: {available: true}, progress_live: true, lan_token: false});
  if (path === '/api/prepare') {
    const setEnv = body.attributes?.environment?.intent === 'set';
    return json({valid: setEnv || body.mode === 'generate', status: 'compatible', issues: setEnv || body.mode === 'generate' ? [] : [
      {code: 'missing_change', level: 'error', kind: 'product', field: 'attributes', message: 'Nenhuma alteração foi pedida para a foto.'}],
      slots: {}, prompt: setEnv ? 'Create an image.\nSetting: a quiet garden.' : 'Create an image.',
      segments: setEnv ? [{block: 'header', text: 'Create an image.'}, {block: 'op.environment', text: 'Setting: a quiet garden.'}] : [{block: 'header', text: 'Create an image.'}], checks: []});
  }
  if (path === '/api/runs' && init?.method === 'POST') return json(run());
  if (path.startsWith('/api/runs?')) return json({runs: [run()]});
  if (path.startsWith('/api/runs/') && path.endsWith('/cancel')) {runStatus = 'cancelled'; return json(run());}
  if (path.startsWith('/api/runs/by-request/')) return json({error: 'x'}, 404);
  if (path.startsWith('/api/runs/')) return json(run());
  return json({error: 'unexpected ' + path}, 500);
}
const run = () => ({id: 'run1', request_id: 'r', status: runStatus, mode: 'generate', prompt: 'Create an image.', effective_prompt: 'Create an image.',
  refined_prompt: null, error: null, best_task_id: null, cancel_requested: runStatus === 'cancelled', created_at: 1, updated_at: 1,
  settings: {profile: 'qwen21', resolution: 1024, variations: 1, seed: 5, verify: false, refine: false, checks: [], compiler_version: '1'},
  images: [], tasks: [{id: 't1', kind: 'image', position: 0, status: 'running', live: {phase: 'loading_models', node_class: 'UNETLoader', value: null, maximum: null, since: 1}}], events: []});

beforeEach(() => {
  calls = []; runStatus = 'generating';
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn((path: string, init?: RequestInit) => respond(path, init)));
  vi.stubGlobal('EventSource', undefined);
});
afterEach(() => {cleanup(); vi.unstubAllGlobals();});

describe('Studio', () => {
  it('composes from the fields, submits once and follows the run with phases', async () => {
    render(<App />);
    const environment = await screen.findByLabelText('Cenário');
    fireEvent.change(environment, {target: {value: 'catalog:environment.garden'}});
    await screen.findByText('Setting: a quiet garden.');
    const generate = screen.getByRole('button', {name: 'Gerar imagem'});
    await waitFor(() => expect((generate as HTMLButtonElement).disabled).toBe(false));
    await act(async () => {fireEvent.click(generate);});
    const posts = calls.filter(c => c.path === '/api/runs' && c.body);
    expect(posts).toHaveLength(1);
    expect(posts[0].body.request.attributes.environment).toEqual({intent: 'set', value: {kind: 'catalog', item_id: 'environment.garden'}});
    expect(posts[0].body.request_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await screen.findByText('Carregando modelos')).toBeTruthy();
    const stop = screen.getByRole('button', {name: '■ Parar'});
    await act(async () => {fireEvent.click(stop);});
    expect(calls.some(c => c.path === '/api/runs/run1/cancel')).toBe(true);
  });

  it('starts edits keeping the photo and blocks generation without a change', async () => {
    render(<App />);
    await screen.findByLabelText('Cenário');
    fireEvent.click(screen.getByRole('radio', {name: 'Editar foto'}));
    expect(((await screen.findByLabelText('Cenário')) as HTMLSelectElement).value).toBe('keep');
    expect(await screen.findByText('Nenhuma alteração foi pedida para a foto.')).toBeTruthy();
    expect((screen.getByRole('button', {name: 'Gerar edição'}) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('History', () => {
  it('filters, deletes a finished run and keeps files still attached in the editor', async () => {
    runStatus = 'completed';
    vi.stubGlobal('confirm', () => true);
    const fetchMock = vi.fn((path: string, init?: RequestInit) => path === '/api/runs/delete'
      ? (calls.push({path, body: JSON.parse(init!.body as string)}), Promise.resolve(new Response(JSON.stringify({deleted: ['run1'], files_removed: 1}), {status: 200})))
      : respond(path, init));
    vi.stubGlobal('fetch', fetchMock);
    const {History} = await import('./components/History');
    const notify = vi.fn();
    render(<History activeRun="run1" onSelect={() => undefined} keepFiles={['abc']} notify={notify} />);
    expect(await screen.findByRole('tab', {name: /Concluídos 1/})).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', {name: /Em andamento/}));
    expect(await screen.findByText('Nenhum pedido neste filtro.')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', {name: /Todos/}));
    await act(async () => {fireEvent.click(await screen.findByRole('button', {name: 'Apagar este pedido'}));});
    const request = calls.find(c => c.path === '/api/runs/delete');
    expect(request?.body).toEqual({ids: ['run1'], keep_files: ['abc']});
    expect(notify).toHaveBeenCalledWith('1 pedido apagado.');
  });
});
