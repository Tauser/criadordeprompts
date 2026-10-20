import type {CoherenceJob, Health, PeopleCount, Stats, Item, LibrarySnapshot, PoseTest, Prepared, ReferenceDescription, Run,
  StudioRequest, TextFinding} from './types';

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
  const data = await response.json().catch(() => {
    if (response.ok) throw new Error('Resposta inválida do servidor. Não foi possível confirmar a operação.');
    return {error: 'Resposta inválida do servidor.'};
  });
  if (!response.ok) throw new ApiError(response.status,
    data && typeof data === 'object' && !Array.isArray(data) ? data : {error: 'Resposta inválida do servidor.'});
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new Error('Resposta inválida do servidor. Não foi possível confirmar a operação.');
  return data as T;
}

export const api = {
  health: () => call<Health>('GET', '/api/health'),
  stats: (since = 0) => call<Stats>('GET', `/api/stats?since=${Math.floor(since)}`),
  library: () => call<LibrarySnapshot>('GET', '/api/library'),
  loras: () => call<{available: boolean; loras: string[]}>('GET', '/api/loras'),
  auditItem: (item: Item) => call<{findings: TextFinding[]}>('POST', '/api/library/audit', item),
  auditLibrary: () => call<Record<string, TextFinding[]>>('GET', '/api/library/audit'),
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
  deleteRuns: (ids: string[], keepFiles: string[]) =>
    call<{deleted: string[]; files_removed: number}>('POST', '/api/runs/delete', {ids, keep_files: keepFiles}),
  repeat: (id: string, requestId: string, sameSeed: boolean) =>
    call<Run>('POST', `/api/runs/${id}/repeat`, {request_id: requestId, same_seed: sameSeed}, 60000),
  cancel: (id: string) => call<Run>('POST', `/api/runs/${id}/cancel`),
  resubmit: (id: string, taskId: string) => call<Run>('POST', `/api/runs/${id}/tasks/${taskId}/resubmit`),
  review: (id: string, choice: 'refined' | 'original') => call<Run>('POST', `/api/runs/${id}/review`, {choice}),
  countPeople: (hash: string) => call<PeopleCount>('POST', `/api/files/${hash}/people`),
  peopleCount: (id: string) => call<PeopleCount>('GET', `/api/people-counts/${id}`),
  cancelPeopleCount: (id: string) => call<unknown>('POST', `/api/people-counts/${id}/cancel`),
  translate: (text: string) => call<{id: string; status: string}>('POST', '/api/translations', {text}),
  cancelTranslation: (id: string) => call<unknown>('POST', `/api/translations/${id}/cancel`),
  reviewCoherence: (request: StudioRequest) => call<CoherenceJob>('POST', '/api/coherence', request),
  coherence: (id: string) => call<CoherenceJob>('GET', `/api/coherence/${id}`),
  cancelCoherence: (id: string) => call<unknown>('POST', `/api/coherence/${id}/cancel`),
  describeReference: (file: string, category: string) =>
    call<ReferenceDescription>('POST', '/api/library/descriptions', {file, category}),
  referenceDescription: (id: string) => call<ReferenceDescription>('GET', `/api/library/descriptions/${id}`),
  cancelReferenceDescription: (id: string) => call<unknown>('POST', `/api/library/descriptions/${id}/cancel`),
  testPose: (item: Item, content_mode: 'standard' | 'adult', confirmations: string[]) =>
    call<PoseTest>('POST', '/api/library/pose-tests', {item, content_mode, confirmations}),
  poseTest: (id: string) => call<PoseTest>('GET', `/api/library/pose-tests/${id}`),
  cancelPoseTest: (id: string) => call<unknown>('POST', `/api/library/pose-tests/${id}/cancel`),
  translation: (id: string) => call<{id: string; status: string; text?: string; error?: string}>('GET', `/api/translations/${id}`),
};

export const fileUrl = (hash: string) => `/api/files/${hash}`;
export const poseTestUrl = (id: string) => `/api/library/pose-tests/${id}/image`;
