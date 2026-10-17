import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ApiError, api} from '../api/client';
import type {Attribute, Category, LibrarySnapshot, Prepared, Run, StudioRequest} from '../api/types';
import {ADVANCED, BASIC, RUN_STATUS, TERMINAL} from '../lib/labels';
import {load, save} from '../lib/storage';
import {useRun} from '../lib/useRun';
import {addReference, enterManual, filesForSubmit, initialWorkspace, leaveManual, removeReference, requestForSubmit,
  setAttribute, setTarget, switchMode, type Workspace} from '../state/workspace';
import {AttributeField} from './AttributeField';
import {History} from './History';
import {PromptPreview} from './PromptPreview';
import {References} from './References';
import {RunPanel} from './RunPanel';

type Drafts = Record<'generate' | 'edit', Workspace>;
const DRAFTS_KEY = 'kppb.drafts.v1', ACTIVE_KEY = 'kppb.active-run', PENDING_KEY = 'kppb.pending-request';

interface Props {library: LibrarySnapshot; comfyOnline: boolean; notify: (m: string, e?: boolean) => void}

export function Studio({library, comfyOnline, notify}: Props) {
  const stored = load<{mode: 'generate' | 'edit'; drafts: Drafts} | null>(DRAFTS_KEY, null);
  const [drafts, setDrafts] = useState<Drafts>(stored?.drafts ?? {generate: initialWorkspace('generate'), edit: initialWorkspace('edit')});
  const [workspace, setWorkspace] = useState<Workspace>(stored ? stored.drafts[stored.mode] : initialWorkspace('generate'));
  const [tab, setTab] = useState<'basic' | 'advanced'>('basic');
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [activeRun, setActiveRun] = useState<string | null>(load<string | null>(ACTIVE_KEY, null));
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
      .catch(error => {if (error instanceof ApiError && error.status === 404) save(PENDING_KEY, null);})
      .finally(() => undefined);
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

  const busy = !!run && !TERMINAL.has(run.status);
  const changeMode = (mode: 'generate' | 'edit') => {
    if (mode === request.mode) return;
    const result = switchMode(drafts, workspace, mode);
    setDrafts(result.drafts); setWorkspace(result.workspace);
  };
  const itemsFor = (category: Category) => library.items.filter(i => i.category === category && i.enabled
    && (request.content_mode === 'adult' || !i.adult));
  const field = (category: Category) => (
    <AttributeField key={category} category={category} mode={request.mode} targetId={request.target_id}
      attribute={request.attributes[category] ?? {intent: 'free'}} items={itemsFor(category)} references={request.references}
      disabled={request.prompt_mode === 'manual'} issues={issuesByField[`attributes.${category}`] ?? []}
      onChange={(attribute: Attribute) => update(ws => setAttribute(ws, category, attribute))} />
  );

  const submit = async () => {
    if (!prepared?.valid) {notify('Corrija os erros antes de gerar.', true); return;}
    const requestId = crypto.randomUUID();
    save(PENDING_KEY, requestId);
    setSubmitting(true);
    try {
      const created: Run = await api.createRun({request_id: requestId, request: requestForSubmit(workspace),
        files: filesForSubmit(workspace), mask: request.mask ? workspace.maskHash : null});
      setActiveRun(created.id);
      save(PENDING_KEY, null);
    } catch (error) {
      if (error instanceof ApiError) {save(PENDING_KEY, null); notify(error.message, true);}
      else notify('Sem resposta do Studio. Assim que ele responder, o pedido será localizado sem duplicar.', true);
    } finally {setSubmitting(false);}
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
    if (request.mode !== 'edit') {setDrafts(d => ({...d, generate: workspace})); }
    setWorkspace(next);
    notify('Resultado definido como foto alvo. Revise os campos antes de gerar.');
  };
  const focusField = (path: string) => {
    const category = path.startsWith('attributes.') ? path.split('.')[1] as Category : null;
    if (category) setTab(ADVANCED.includes(category) ? 'advanced' : 'basic');
    window.setTimeout(() => document.getElementById(category ? `field-${category}` : 'confirmations')?.focus(), 50);
  };
  const toggleManual = (enabled: boolean) => {
    if (enabled) update(ws => enterManual(ws, prepared?.prompt ?? ''));
    else if (request.manual_prompt === prepared?.prompt || confirm('Voltar aos campos descarta o texto manual. Continuar?')) update(leaveManual);
  };

  return (
    <>
      <div className="workspace">
        <div className="column">
          <div className="mode-switch" role="radiogroup" aria-label="Modo">
            {(['generate', 'edit'] as const).map(mode => (
              <button key={mode} role="radio" aria-checked={request.mode === mode} className={request.mode === mode ? 'active' : ''}
                      onClick={() => changeMode(mode)}>{mode === 'generate' ? 'Criar imagem' : 'Editar foto'}</button>
            ))}
          </div>
          <References workspace={workspace} slots={prepared?.slots ?? {}} disabled={false} update={update} notify={notify} />
          <section className="card">
            <div className="tabs" role="tablist">
              <button role="tab" aria-selected={tab === 'basic'} onClick={() => setTab('basic')}>Básico</button>
              <button role="tab" aria-selected={tab === 'advanced'} onClick={() => setTab('advanced')}>Avançado</button>
            </div>
            {tab === 'basic' ? (
              <div role="tabpanel">
                <div className="fields two">{BASIC.map(field)}</div>
                <label className="block">Detalhes adicionais (inglês)
                  <textarea rows={3} value={request.details} maxLength={4000} disabled={request.prompt_mode === 'manual'}
                            placeholder="Ex.: a blue ceramic mug on the table" onChange={e => patch(r => {r.details = e.target.value;})} />
                </label>
                <p className="help">Enviados como estão, depois das instruções dos campos. Não alteram as outras instruções.</p>
                <OutputBasics request={request} patch={patch} />
              </div>
            ) : (
              <div role="tabpanel">
                <div className="fields two">{ADVANCED.map(field)}</div>
                <SceneContext request={request} patch={patch} />
                <Engine request={request} patch={patch} />
                <Content request={request} patch={patch} library={library} update={update} />
              </div>
            )}
          </section>
        </div>
        <div className="column">
          <PromptPreview request={request} prepared={prepared} pending={pending} error={prepareError}
            onManual={toggleManual} onManualText={text => patch(r => {r.manual_prompt = text;})} onFocusField={focusField} />
          <RunPanel run={run} connection={connection} onReuse={reuse} notify={notify} />
          <History activeRun={activeRun} onSelect={setActiveRun} />
        </div>
      </div>
      <footer className="execution-bar" aria-label="Execução">
        <div className="execution-info" aria-live="polite">
          <strong>{run ? RUN_STATUS[run.status] ?? run.status : 'Pronto'}</strong>
          <span className="muted">{!comfyOnline ? 'ComfyUI offline: o pedido fica na fila do Studio até ele voltar.' :
            run?.status === 'review' ? 'Revise o texto aprimorado no painel de resultado.' : run?.error ?? ''}</span>
        </div>
        <button className="stop" disabled={!busy || run?.cancel_requested} onClick={stop}>
          {run?.cancel_requested && busy ? 'Parando…' : '■ Parar'}</button>
        <button className="primary" disabled={submitting || busy || !prepared?.valid} onClick={submit}>
          {submitting ? 'Enviando…' : request.mode === 'edit' ? 'Gerar edição' : 'Gerar imagem'}</button>
      </footer>
    </>
  );
}

type Patch = (fn: (r: StudioRequest) => void) => void;

function OutputBasics({request, patch}: {request: StudioRequest; patch: Patch}) {
  const edit = request.mode === 'edit', custom = request.output.width != null;
  return (
    <div className="fields three">
      <label>Execução<select value={request.output.profile} onChange={e => patch(r => {r.output.profile = e.target.value as 'qwen21' | 'turbo'; if (r.output.profile === 'turbo') r.output.refine = false;})}>
        <option value="qwen21">Completa (40 passos)</option><option value="turbo">Turbo (8 passos)</option></select></label>
      <label>Resolução<select value={request.output.resolution} disabled={request.mask}
        onChange={e => patch(r => {r.output.resolution = Number(e.target.value) as StudioRequest['output']['resolution'];})}>
        {edit && <option value={0}>Original da foto</option>}
        <option value={1024}>1024 · rápida</option><option value={1536}>1536</option><option value={2048}>2048 · alta</option></select></label>
      <label>Formato<select value={request.output.aspect} disabled={edit || custom}
        onChange={e => patch(r => {r.output.aspect = e.target.value as StudioRequest['output']['aspect'];})}>
        {['3:4', '2:3', '1:1', '4:3', '3:2', '16:9', '9:16'].map(a => <option key={a} value={a}>{a}</option>)}</select></label>
      <label>Variações<select value={request.output.variations} onChange={e => patch(r => {r.output.variations = Number(e.target.value);})}>
        {[1, 2, 3, 4].map(v => <option key={v} value={v}>{v}</option>)}</select></label>
      <label className="check"><input type="checkbox" checked={request.output.verify}
        onChange={e => patch(r => {r.output.verify = e.target.checked;})} /> Verificar o resultado automaticamente</label>
      <label className="check"><input type="checkbox" checked={request.output.refine} disabled={request.output.profile === 'turbo'}
        onChange={e => patch(r => {r.output.refine = e.target.checked;})} /> Aprimorar o prompt (com revisão)</label>
    </div>
  );
}

function SceneContext({request, patch}: {request: StudioRequest; patch: Patch}) {
  const edit = request.mode === 'edit';
  const supports = request.context.supports;
  const num = (v: string) => v === '' ? null : Math.max(0, Math.min(10, Number(v)));
  return (
    <fieldset><legend>Cena</legend>
      <div className="fields three">
        <label>Pessoas pedidas<input type="number" min={1} max={10} value={request.participants.requested ?? ''}
          onChange={e => patch(r => {r.participants.requested = num(e.target.value) || null;})} /></label>
        {edit && <label>Pessoas na foto<input type="number" min={0} max={10} value={request.participants.existing ?? ''}
          onChange={e => patch(r => {r.participants.existing = num(e.target.value);})} /></label>}
        {edit && <label>Enquadramento da foto<select value={request.context.original_framing ?? ''}
          onChange={e => patch(r => {r.context.original_framing = (e.target.value || null) as StudioRequest['context']['original_framing'];})}>
          <option value="">Não informado</option><option value="portrait">Rosto e ombros</option><option value="half">Meio corpo</option>
          <option value="full">Corpo inteiro</option><option value="wide">Plano aberto</option></select></label>}
      </div>
      {edit && <>
        <label className="check"><input type="checkbox" checked={supports != null} onChange={e => patch(r => {r.context.supports = e.target.checked ? [] : null;})} /> Sei quais apoios existem na foto</label>
        {supports != null && <div className="checks">{(['floor', 'seat', 'bed', 'wall', 'table'] as const).map(s => (
          <label key={s} className="check"><input type="checkbox" checked={supports.includes(s)} onChange={e => patch(r => {
            const set = new Set(r.context.supports ?? []); if (e.target.checked) set.add(s); else set.delete(s); r.context.supports = [...set];
          })} /> {({floor: 'chão', seat: 'assento', bed: 'cama', wall: 'parede', table: 'mesa'})[s]}</label>))}</div>}
        <label className="check"><input type="checkbox" checked={request.context.allow_new_supports}
          onChange={e => patch(r => {r.context.allow_new_supports = e.target.checked;})} /> Permitir acrescentar apoios necessários</label>
        <label className="check"><input type="checkbox" checked={request.context.allow_reframing}
          onChange={e => patch(r => {r.context.allow_reframing = e.target.checked;})} /> Permitir reenquadrar</label>
      </>}
    </fieldset>
  );
}

function Engine({request, patch}: {request: StudioRequest; patch: Patch}) {
  const turbo = request.output.profile === 'turbo';
  const num = (v: string) => v === '' ? null : Number(v);
  const custom = request.output.width != null;
  return (
    <fieldset><legend>Parâmetros</legend>
      <div className="fields three">
        <label>Seed<input type="number" min={0} placeholder="Aleatória" value={request.output.seed ?? ''}
          onChange={e => patch(r => {r.output.seed = num(e.target.value);})} /></label>
        <label>Passos<input type="number" min={1} max={100} disabled={turbo} placeholder="40" value={request.engine.steps ?? ''}
          onChange={e => patch(r => {r.engine.steps = num(e.target.value);})} /></label>
        <label>CFG<input type="number" min={1} max={20} step={0.1} disabled={turbo} placeholder="1" value={request.engine.cfg ?? ''}
          onChange={e => patch(r => {r.engine.cfg = num(e.target.value);})} /></label>
      </div>
      <label className="check"><input type="checkbox" checked={custom} onChange={e => patch(r => {
        r.output.width = e.target.checked ? 1024 : null; r.output.height = e.target.checked ? 1024 : null;})} /> Tamanho personalizado</label>
      {custom && <div className="fields three">
        <label>Largura<input type="number" min={256} max={2048} step={32} value={request.output.width ?? ''} onChange={e => patch(r => {r.output.width = num(e.target.value);})} /></label>
        <label>Altura<input type="number" min={256} max={2048} step={32} value={request.output.height ?? ''} onChange={e => patch(r => {r.output.height = num(e.target.value);})} /></label>
      </div>}
      <label className="block">Prompt negativo (só tem efeito com CFG acima de 1)
        <textarea rows={2} value={request.engine.negative_prompt} disabled={(request.engine.cfg ?? 1) <= 1}
          onChange={e => patch(r => {r.engine.negative_prompt = e.target.value;})} /></label>
    </fieldset>
  );
}

function Content({request, patch, library, update}: {request: StudioRequest; patch: Patch; library: LibrarySnapshot;
  update: (fn: (ws: Workspace) => Workspace) => void}) {
  const adultIds = new Set(library.items.filter(i => i.adult).map(i => i.id));
  const setAdult = (on: boolean) => {
    if (on) {patch(r => {r.content_mode = 'adult';}); return;}
    update(ws => {
      const next = structuredClone(ws);
      next.request.content_mode = 'standard';
      next.request.confirmations = [];
      for (const [category, attribute] of Object.entries(next.request.attributes)) {
        if (attribute?.intent === 'set' && attribute.value?.kind === 'catalog' && adultIds.has(attribute.value.item_id))
          next.request.attributes[category as Category] = next.request.mode === 'edit' ? {intent: 'keep'} : {intent: 'free'};
      }
      return next;
    });
  };
  const confirmation = (key: 'adults_only' | 'consent_or_fictional', on: boolean) => patch(r => {
    const set = new Set(r.confirmations); if (on) set.add(key); else set.delete(key); r.confirmations = [...set];
  });
  return (
    <fieldset id="confirmations" tabIndex={-1}><legend>Conteúdo</legend>
      <label className="check"><input type="checkbox" checked={request.content_mode === 'adult'} onChange={e => setAdult(e.target.checked)} /> Mostrar opções adultas (+18)</label>
      <p className="help">Só organiza a biblioteca. Não muda as instruções dos outros campos.</p>
      {request.content_mode === 'adult' && <>
        <label className="check"><input type="checkbox" checked={request.confirmations.includes('adults_only')}
          onChange={e => confirmation('adults_only', e.target.checked)} /> Confirmo que todas as pessoas retratadas são adultas.</label>
        {request.mode === 'edit' && <label className="check"><input type="checkbox" checked={request.confirmations.includes('consent_or_fictional')}
          onChange={e => confirmation('consent_or_fictional', e.target.checked)} /> Confirmo que a pessoa da foto é fictícia ou consentiu com esta edição.</label>}
      </>}
    </fieldset>
  );
}
