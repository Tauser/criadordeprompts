import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ApiError, api} from '../api/client';
import type {Attribute, Category, LibrarySnapshot, Prepared, Run, StudioRequest} from '../api/types';
import {TERMINAL} from '../lib/labels';
import {load, save} from '../lib/storage';
import {useRun} from '../lib/useRun';
import {addReference, enterManual, filesForSubmit, initialWorkspace, leaveManual, removeReference, requestForSubmit,
  setAttribute, setTarget, switchMode, type Workspace} from '../state/workspace';
import {Composer} from './Composer';
import {Gallery} from './Gallery';
import {Picker} from './Picker';
import {Settings, type SettingsTab} from './Settings';
import {ReviewDialog, Viewer} from './Viewer';

type Drafts = Record<'generate' | 'edit', Workspace>;
const DRAFTS_KEY = 'prisma.drafts.v1', ACTIVE_KEY = 'prisma.active-run', PENDING_KEY = 'prisma.pending-request';
// Drafts saved before the rename are read once from the old keys.
const LEGACY = {drafts: 'kppb.drafts.v1', active: 'kppb.active-run'};

interface Props {library: LibrarySnapshot; comfyOnline: boolean; notify: (m: string, e?: boolean) => void}

export function Studio({library, comfyOnline, notify}: Props) {
  const stored = load<{mode: 'generate' | 'edit'; drafts: Drafts} | null>(DRAFTS_KEY, null)
    ?? load<{mode: 'generate' | 'edit'; drafts: Drafts} | null>(LEGACY.drafts, null);
  const [drafts, setDrafts] = useState<Drafts>(stored?.drafts ?? {generate: initialWorkspace('generate'), edit: initialWorkspace('edit')});
  const [workspace, setWorkspace] = useState<Workspace>(stored ? stored.drafts[stored.mode] : initialWorkspace('generate'));
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [activeRun, setActiveRun] = useState<string | null>(load<string | null>(ACTIVE_KEY, null) ?? load<string | null>(LEGACY.active, null));
  const [picker, setPicker] = useState<Category | null>(null);
  const [settings, setSettings] = useState<SettingsTab | null>(null);
  const [viewer, setViewer] = useState(false);
  const [order, setOrder] = useState<string[]>([]);
  const {run, connection} = useRun(activeRun);
  const epoch = useRef(0);
  const request = workspace.request;

  const update = useCallback((next: Workspace | ((ws: Workspace) => Workspace)) => {
    setWorkspace(current => (typeof next === 'function' ? next(current) : next));
  }, []);
  const patch = (fn: (r: StudioRequest) => void) => update(ws => {
    const next = structuredClone(ws);
    fn(next.request);
    return next;
  });

  useEffect(() => save(DRAFTS_KEY, {mode: request.mode, drafts: {...drafts, [request.mode]: workspace}}), [workspace, drafts, request.mode]);
  useEffect(() => save(ACTIVE_KEY, activeRun), [activeRun]);

  // Recover a submission whose answer never arrived (network drop, closed tab).
  useEffect(() => {
    const pendingId = load<string | null>(PENDING_KEY, null);
    if (!pendingId) return;
    api.runByRequest(pendingId).then(found => {setActiveRun(found.id); notify('O pedido anterior chegou ao Studio e está sendo acompanhado.');})
      .catch(error => {if (error instanceof ApiError && error.status === 404) save(PENDING_KEY, null);});
  }, [notify]);

  useEffect(() => {
    const token = ++epoch.current;
    setPending(true);
    const timer = window.setTimeout(async () => {
      try {
        const result = await api.prepare(requestForSubmit(workspace));
        if (token !== epoch.current) return;
        setPrepared(result); setPrepareError(null);
      } catch (error) {
        if (token !== epoch.current) return;
        setPrepared(null);
        setPrepareError(error instanceof ApiError && error.status === 422 ? 'Preencha os campos obrigatórios (descrições vazias ou valores fora do permitido).' : (error as Error).message);
      } finally {
        if (token === epoch.current) setPending(false);
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [workspace]);

  const issuesByField = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const issue of prepared?.issues ?? []) (map[issue.field] ??= []).push(issue.message);
    return map;
  }, [prepared]);
  const errorCount = prepared?.issues.filter(i => i.level === 'error').length ?? 0;
  const busy = !!run && !TERMINAL.has(run.status);

  const changeMode = (mode: 'generate' | 'edit') => {
    if (mode === request.mode) return;
    const result = switchMode(drafts, workspace, mode);
    setDrafts(result.drafts); setWorkspace(result.workspace);
  };
  const itemsFor = useCallback((category: Category) => library.items.filter(i => i.category === category && i.enabled
    && (request.content_mode === 'adult' || !i.adult)), [library, request.content_mode]);
  const setField = (category: Category, attribute: Attribute) => update(ws => setAttribute(ws, category, attribute));

  const follow = (created: Run) => {setActiveRun(created.id); save(PENDING_KEY, null);};
  const failed = (error: unknown) => {
    if (error instanceof ApiError) {save(PENDING_KEY, null); notify(error.message, true);}
    else notify('Sem resposta do Studio. Assim que ele responder, o pedido será localizado sem duplicar.', true);
  };
  const submit = async () => {
    if (!prepared?.valid) {notify('Corrija os erros antes de gerar.', true); setSettings('prompt'); return;}
    const requestId = crypto.randomUUID();
    save(PENDING_KEY, requestId);
    setSubmitting(true);
    try {
      follow(await api.createRun({request_id: requestId, request: requestForSubmit(workspace),
        files: filesForSubmit(workspace), mask: request.mask ? workspace.maskHash : null}));
    } catch (error) {failed(error);} finally {setSubmitting(false);}
  };
  const repeat = async (sameSeed: boolean) => {
    if (!run) return;
    const requestId = crypto.randomUUID();
    save(PENDING_KEY, requestId);
    try {
      follow(await api.repeat(run.id, requestId, sameSeed));
      notify(sameSeed ? 'Repetindo com a mesma seed.' : 'Gerando de novo com uma nova seed.');
    } catch (error) {failed(error);}
  };
  const stop = async () => {
    if (!activeRun) return;
    try {await api.cancel(activeRun);} catch (error) {notify((error as Error).message, true);}
  };
  const reuse = (hash: string) => {
    const base = request.mode === 'edit' ? workspace : drafts.edit;
    let next = base;
    if (next.request.target_id) next = removeReference(next, next.request.target_id);
    const id = 'ref-' + crypto.randomUUID().slice(0, 8);
    next = addReference(next, id, {hash, width: 0, height: 0, name: 'resultado.png'});
    next = setTarget(next, id);
    fetch(`/api/files/${hash}`).then(r => r.blob()).then(blob => createImageBitmap(blob)).then(bitmap =>
      update(ws => ({...ws, files: {...ws.files, [id]: {...ws.files[id], width: bitmap.width, height: bitmap.height}}}))).catch(() => undefined);
    if (request.mode !== 'edit') setDrafts(d => ({...d, generate: workspace}));
    setWorkspace(next);
    setViewer(false);
    notify('Imagem pronta para editar. Escolha o que mudar e clique em Gerar edição.');
  };
  const focusIssue = (path: string) => {
    const category = path.startsWith('attributes.') ? path.split('.')[1] as Category : null;
    if (category) {setSettings(null); setPicker(category);}
    else if (path.startsWith('confirmations') || path.startsWith('participants') || path.startsWith('context') || path === 'details') setSettings('advanced');
  };
  const toggleManual = (enabled: boolean) => {
    if (enabled) update(ws => enterManual(ws, prepared?.prompt ?? ''));
    else if (request.manual_prompt === prepared?.prompt || confirm('Voltar aos campos descarta o texto manual. Continuar?')) update(leaveManual);
  };
  const openRun = (id: string) => {setActiveRun(id); setViewer(true);};
  const step = (delta: number) => {
    const index = activeRun ? order.indexOf(activeRun) : -1;
    const next = order[index + delta];
    if (index >= 0 && next) setActiveRun(next);
  };

  // Ctrl+Enter generates, Esc closes the open layer or stops the run — the usual shortcuts of creative tools.
  const overlay = picker !== null || settings !== null || viewer;
  const shortcuts = useRef({submit, stop, busy, valid: !!prepared?.valid, overlay});
  shortcuts.current = {submit, stop, busy, valid: !!prepared?.valid, overlay};
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const s = shortcuts.current;
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && s.valid && !s.busy) {event.preventDefault(); s.submit();}
      else if (event.key === 'Escape' && !s.overlay && s.busy && !(event.target as HTMLElement)?.closest('.mask-editor')) s.stop();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const keepFiles = [...Object.values(workspace.files).map(f => f.hash), ...(workspace.maskHash ? [workspace.maskHash] : [])];

  return (
    <div className="studio">
      <Gallery activeRun={activeRun} liveRun={run} onOpen={openRun} keepFiles={keepFiles} notify={notify} onOrder={setOrder}
               onDeleted={ids => {if (activeRun && ids.includes(activeRun)) {setActiveRun(null); setViewer(false);}}} />
      <Composer workspace={workspace} prepared={prepared} pending={pending} errorCount={errorCount} busy={busy} submitting={submitting}
        run={run} comfyOnline={comfyOnline} library={library} update={update} patch={patch} notify={notify}
        onMode={changeMode} onPick={category => setPicker(category)} onField={setField} onSubmit={submit} onStop={stop}
        onSettings={tab => setSettings(tab)} onOpenRun={() => activeRun && setViewer(true)} />
      {picker && <Picker category={picker} request={request} itemsFor={itemsFor} issuesByField={issuesByField}
        onCategory={setPicker} onChange={setField} onClose={() => setPicker(null)} />}
      {settings && <Settings tab={settings} onTab={setSettings} onClose={() => setSettings(null)} request={request} prepared={prepared}
        pending={pending} error={prepareError} library={library} patch={patch} update={update}
        onManual={toggleManual} onFocusIssue={focusIssue} />}
      {viewer && run && <Viewer run={run} connection={connection} onClose={() => setViewer(false)} onReuse={reuse} onRepeat={repeat}
        onStop={stop} onStep={step} canStep={{prev: order.indexOf(run.id) > 0, next: order.indexOf(run.id) >= 0 && order.indexOf(run.id) < order.length - 1}}
        notify={notify} />}
      {run?.status === 'review' && <ReviewDialog run={run} notify={notify} />}
    </div>
  );
}
