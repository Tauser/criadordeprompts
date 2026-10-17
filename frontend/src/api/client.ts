import type {Health, LibrarySnapshot, Prepared, Run, StudioRequest} from './types';

export class ApiError extends Error {
  constructor(public status: number, public body: {error?: string; issues?: unknown[]; details?: unknown[]}) {
    super(body.error || `Falha ${status}`);
  }
}

async function call<T>(method: string, path: string, body?: unknown, timeoutMs = 30000): Promise<T> {
  const init: RequestInit = {method, signal: AbortSignal.timeout(timeoutMs)};
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = {'Content-Type': 'application/json'};
  }
  const response = await fetch(path, init);
  const data = await response.json().catch(() => ({error: 'Resposta inválida do servidor.'}));
  if (!response.ok) throw new ApiError(response.status, data);
  return data as T;
}

export const api = {
  health: () => call<Health>('GET', '/api/health'),
  library: () => call<LibrarySnapshot>('GET', '/api/library'),
  saveLibrary: (revision: number, items: unknown[]) => call<LibrarySnapshot>('PUT', '/api/library', {revision, items}),
  prepare: (request: StudioRequest) => call<Prepared>('POST', '/api/prepare', request),
  upload: (file: Blob, name: string) => {
    const form = new FormData();
    form.append('file', file, name);
    return call<{hash: string; mime: string; width: number; height: number}>('POST', '/api/files', form, 120000);
  },
  createRun: (body: {request_id: string; request: StudioRequest; files: Record<string, string>; mask: string | null}) =>
    call<Run>('POST', '/api/runs', body, 60000),
  run: (id: string) => call<Run>('GET', `/api/runs/${id}`),
  runByRequest: (requestId: string) => call<Run>('GET', `/api/runs/by-request/${requestId}`),
  runs: () => call<{runs: Run[]}>('GET', '/api/runs?limit=40'),
  cancel: (id: string) => call<Run>('POST', `/api/runs/${id}/cancel`),
  review: (id: string, choice: 'refined' | 'original') => call<Run>('POST', `/api/runs/${id}/review`, {choice}),
  translate: (text: string) => call<{id: string; status: string}>('POST', '/api/translations', {text}),
  translation: (id: string) => call<{id: string; status: string; text?: string; error?: string}>('GET', `/api/translations/${id}`),
};

export const fileUrl = (hash: string) => `/api/files/${hash}`;
