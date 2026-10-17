import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ApiError, api} from '../api/client';
import type {Attribute, Category, LibrarySnapshot, Prepared, Run, StudioRequest} from '../api/types';
import {CATEGORY_LABELS, RUN_STATUS, TERMINAL} from '../lib/labels';
import {load, save} from '../lib/storage';
import {useRun} from '../lib/useRun';
import {addReference, enterManual, filesForSubmit, initialWorkspace, leaveManual, removeReference, requestForSubmit,
  setAttribute, setTarget, switchMode, type Workspace} from '../state/workspace';
import {AttributeField} from './AttributeField';
import {Canvas} from './Canvas';
import {History} from './History';
import {Icon} from './Icon';
import {PromptPreview} from './PromptPreview';
import {References} from './References';
import {Section} from './Section';

type Drafts = Record<'generate' | 'edit', Workspace>;
const DRAFTS_KEY = 'prisma.drafts.v1', ACTIVE_KEY = 'prisma.active-run', PENDING_KEY = 'prisma.pending-request';
const SECTIONS_KEY = 'prisma.sections.v1';
// Drafts saved before the rename are read once from the old keys.
const LEGACY = {drafts: 'kppb.drafts.v1', active: 'kppb.active-run'};
const GROUPS: {id: string; title: string; categories: Category[]}[] = [
  {id: 'scene', title: 'Cena', categories: ['style', 'environment', 'lighting', 'camera', 'framing']},
  {id: 'person', title: 'Pessoa', categories: ['subject', 'face', 'body', 'skin', 'hair', 'wardrobe']},
  {id: 'pose', title: 'Pose e ação', categories: ['pose', 'action', 'expression']},
];
const DEFAULT_OPEN = ['scene', 'person', 'pose', 'details', 'output'];

interface Props {library: LibrarySnapshot; comfyOnline: boolean; notify: (m: string, e?: boolean) => void}

export function Studio({library, comfyOnline, notify}: Props) {
  const stored = load<{mode: 'generate' | 'edit'; drafts: Drafts} | null>(DRAFTS_KEY, null)
    ?? load<{mode: 'generate' | 'edit'; drafts: Drafts} | null>(LEGACY.drafts, null);
  const [drafts, setDrafts] = useState<Drafts>(stored?.drafts ?? {generate: initialWorkspace('generate'), edit: initialWorkspace('edit')});
  const [workspace, setWorkspace] = useState<Workspace>(stored ? stored.drafts[stored.mode] : initialWorkspace('generate'));
  const [open, setOpen] = useState<string[]>(load<string[]>(SECTIONS_KEY, DEFAULT_OPEN));
  const [leftTab, setLeftTab] = useState<'sources' | 'prompt'>('sources');
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [activeRun, setActiveRun] = useState<string | null>(load<string | null>(ACTIVE_KEY, null) ?? load<string | null>(LEGACY.active, null));
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
  const toggleSection = (id: string) => setOpen(current => {
    const next = current.includes(id) ? current.filter(x => x !== id) : [...current, id];
    save(SECTIONS_KEY, next);
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
  const itemsFor = (category: Category) => library.items.filter(i => i.category === category && i.enabled
    && (request.content_mode === 'adult' || !i.adult));
  const field = (category: Category) => (
    <AttributeField key={category} category={category} mode={request.mode} targetId={request.target_id}
      attribute={request.attributes[category] ?? {intent: 'free'}} items={itemsFor(category)} references={request.references}
      disabled={request.prompt_mode === 'manual'} issues={issuesByField[`attributes.${category}`] ?? []}
      onChange={(attribute: Attribute) => update(ws => setAttribute(ws, category, attribute))} />
  );
  const summary = (categories: Category[]) => {
    const changed = categories.filter(c => ['set', 'transfer'].includes(request.attributes[c]?.intent ?? 'free'));
    const issues = categories.some(c => issuesByField[`attributes.${c}`]?.length);
    return (issues ? '⚠ ' : '') + (changed.length ? changed.map(c => CATEGORY_LABELS[c]).join(', ') : request.mode === 'edit' ? 'mantido' : '—');
  };

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
  const repeat = async (sameSeed: boolean) => {
    if (!run) return;
    const requestId = crypto.randomUUID();
    save(PENDING_KEY, requestId);
    try {
      const created = await api.repeat(run.id, requestId, sameSeed);
      setActiveRun(created.id);
      save(PENDING_KEY, null);
      notify(sameSeed ? 'Repetindo com a mesma seed.' : 'Gerando de novo com uma nova seed.');
    } catch (error) {
      if (error instanceof ApiError) {save(PENDING_KEY, null); notify(error.message, true);}
      else notify('Sem resposta do Studio. Assim que ele responder, o pedido será localizado sem duplicar.', true);
    }
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
    setLeftTab('sources');
    notify('Resultado definido como foto alvo. Revise o inspetor antes de gerar.');
  };
  const focusField = (path: string) => {
    const category = path.startsWith('attributes.') ? path.split('.')[1] as Category : null;
    const group = category ? GROUPS.find(g => g.categories.includes(category))?.id : path.startsWith('confirmations') ? 'content'
      : path.startsWith('participants') || path.startsWith('context') ? 'context' : path === 'details' ? 'details' : null;
    if (group && !open.includes(group)) toggleSection(group);
    window.setTimeout(() => document.getElementById(category ? `field-${category}` : 'confirmations')?.focus(), 60);
  };
  const toggleManual = (enabled: boolean) => {
    if (enabled) update(ws => enterManual(ws, prepared?.prompt ?? ''));
    else if (request.manual_prompt === prepared?.prompt || confirm('Voltar aos campos descarta o texto manual. Continuar?')) update(leaveManual);
  };

  // Ctrl+Enter generates, Esc stops — the usual shortcuts of creative tools.
  const shortcuts = useRef({submit, stop, busy, valid: !!prepared?.valid});
  shortcuts.current = {submit, stop, busy, valid: !!prepared?.valid};
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && shortcuts.current.valid && !shortcuts.current.busy) {
        event.preventDefault(); shortcuts.current.submit();
      } else if (event.key === 'Escape' && shortcuts.current.busy && !(event.target as HTMLElement)?.closest('.mask-editor')) {
        shortcuts.current.stop();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const targetHash = request.target_id ? workspace.files[request.target_id]?.hash ?? null : null;

  return (
    <div className="workbench">
      <div className="editor-bar">
        <div className="mode-switch" role="radiogroup" aria-label="Modo">
          {(['generate', 'edit'] as const).map(mode => (
            <button key={mode} role="radio" aria-checked={request.mode === mode} className={request.mode === mode ? 'active' : ''}
                    onClick={() => changeMode(mode)}><Icon name={mode === 'generate' ? 'sparkle' : 'edit'} size={14} />
              {mode === 'generate' ? 'Criar imagem' : 'Editar foto'}</button>
          ))}
        </div>
        <div className="bar-status" aria-live="polite">
          <span className={'status-dot-inline ' + (errorCount ? 'bad' : prepared?.status === 'compatible' ? 'ok' : 'warn')} />
          <button className="link status-link" onClick={() => setLeftTab('prompt')} title="Ver o prompt e os avisos">
            {pending ? 'Atualizando o prompt…' : errorCount ? `${errorCount} ${errorCount === 1 ? 'erro' : 'erros'} para corrigir`
            : prepared ? (prepared.status === 'compatible' ? 'Pedido pronto' : 'Pronto · revise os avisos') : 'Preencha a cena'}</button>
          {run && <span className="muted">· {RUN_STATUS[run.status] ?? run.status}</span>}
          {!comfyOnline && <span className="warn-text">· ComfyUI offline: o pedido aguarda na fila</span>}
        </div>
        <div className="bar-actions">
          <button className="stop" disabled={!busy || run?.cancel_requested} onClick={stop} title="Parar (Esc)">
            {run?.cancel_requested && busy ? 'Parando…' : '■ Parar'}</button>
          <button className="primary generate" disabled={submitting || busy || !prepared?.valid} onClick={submit} title="Gerar (Ctrl+Enter)">
            {submitting ? 'Enviando…' : request.mode === 'edit' ? 'Gerar edição' : 'Gerar imagem'}</button>
        </div>
      </div>

      <aside className="panel left-panel" aria-label="Fontes e prompt">
        <div className="panel-tabs" role="tablist">
          <button role="tab" aria-selected={leftTab === 'sources'} onClick={() => setLeftTab('sources')}><Icon name="layers" size={14} /> Fontes</button>
          <button role="tab" aria-selected={leftTab === 'prompt'} onClick={() => setLeftTab('prompt')}><Icon name="text" size={14} /> Prompt
            {errorCount > 0 && <span className="tab-badge">{errorCount}</span>}</button>
        </div>
        <div className="panel-scroll">
          {leftTab === 'sources'
            ? <References workspace={workspace} slots={prepared?.slots ?? {}} disabled={false} update={update} notify={notify} />
            : <PromptPreview request={request} prepared={prepared} pending={pending} error={prepareError}
                onManual={toggleManual} onManualText={text => patch(r => {r.manual_prompt = text;})} onFocusField={focusField} />}
        </div>
      </aside>

      <main className="center">
        <Canvas run={run} connection={connection} targetHash={targetHash} mode={request.mode} onReuse={reuse} onRepeat={repeat} notify={notify} />
      </main>

      <aside className="panel inspector" aria-label="Inspetor">
        <div className="panel-title"><Icon name="sliders" size={14} /> Inspetor</div>
        <div className="panel-scroll">
          {request.prompt_mode === 'manual' && <p className="issue warning">Prompt manual ativo: os campos abaixo não são usados.</p>}
          {GROUPS.map(group => (
            <Section key={group.id} id={group.id} title={group.title} summary={summary(group.categories)}
                     open={open.includes(group.id)} onToggle={toggleSection}>
              <div className="fields">{group.categories.map(field)}</div>
            </Section>
          ))}
          <Section id="details" title="Detalhes adicionais" summary={request.details ? 'preenchido' : '—'} open={open.includes('details')} onToggle={toggleSection}>
            <label className="block">Texto livre (inglês)
              <textarea rows={3} value={request.details} maxLength={4000} disabled={request.prompt_mode === 'manual'}
                        placeholder="Ex.: a blue ceramic mug on the table" onChange={e => patch(r => {r.details = e.target.value;})} />
            </label>
            <p className="help">Enviado como está, depois das instruções dos campos. Não altera as outras instruções.</p>
          </Section>
          <Section id="output" title="Saída" summary={`${request.output.profile === 'turbo' ? 'Turbo' : 'Completa'} · ${request.output.resolution || 'original'} · ${request.output.variations}×`}
                   open={open.includes('output')} onToggle={toggleSection}>
            <OutputBasics request={request} patch={patch} />
          </Section>
          <Section id="context" title="Contexto da cena" open={open.includes('context')} onToggle={toggleSection}>
            <SceneContext request={request} patch={patch} />
          </Section>
          <Section id="engine" title="Motor" summary={request.output.seed != null ? `seed ${request.output.seed}` : 'padrão'} open={open.includes('engine')} onToggle={toggleSection}>
            <Engine request={request} patch={patch} />
          </Section>
          <Section id="content" title="Conteúdo" summary={request.content_mode === 'adult' ? '+18' : 'padrão'} open={open.includes('content')} onToggle={toggleSection}>
            <Content request={request} patch={patch} library={library} update={update} />
          </Section>
        </div>
      </aside>

      <footer className="bottom">
        <History activeRun={activeRun} onSelect={setActiveRun} notify={notify}
          keepFiles={[...Object.values(workspace.files).map(f => f.hash), ...(workspace.maskHash ? [workspace.maskHash] : [])]} />
      </footer>
    </div>
  );
}

type Patch = (fn: (r: StudioRequest) => void) => void;

function OutputBasics({request, patch}: {request: StudioRequest; patch: Patch}) {
  const edit = request.mode === 'edit', custom = request.output.width != null;
  return (
    <div className="fields two">
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
    <div className="group">
      <div className="fields two">
        <label>Pessoas pedidas<input type="number" min={1} max={10} value={request.participants.requested ?? ''}
          onChange={e => patch(r => {r.participants.requested = num(e.target.value) || null;})} /></label>
        {edit && <label>Pessoas na foto<input type="number" min={0} max={10} value={request.participants.existing ?? ''}
          onChange={e => patch(r => {r.participants.existing = num(e.target.value);})} /></label>}
        {edit && <label>Enquadramento da foto<select value={request.context.original_framing ?? ''}
          onChange={e => patch(r => {r.context.original_framing = (e.target.value || null) as StudioRequest['context']['original_framing'];})}>
          <option value="">Não informado</option><option value="full">Corpo inteiro</option><option value="half">Meio corpo</option>
          <option value="wide">Plano aberto</option><option value="portrait">Rosto e ombros</option></select></label>}
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
    </div>
  );
}

function Engine({request, patch}: {request: StudioRequest; patch: Patch}) {
  const turbo = request.output.profile === 'turbo';
  const num = (v: string) => v === '' ? null : Number(v);
  const custom = request.output.width != null;
  return (
    <div className="group">
      <div className="fields two">
        <label>Seed<input type="number" min={0} placeholder="Aleatória" value={request.output.seed ?? ''}
          onChange={e => patch(r => {r.output.seed = num(e.target.value);})} /></label>
        <label>Passos<input type="number" min={1} max={100} disabled={turbo} placeholder="40" value={request.engine.steps ?? ''}
          onChange={e => patch(r => {r.engine.steps = num(e.target.value);})} /></label>
        <label>CFG<input type="number" min={1} max={20} step={0.1} disabled={turbo} placeholder="1" value={request.engine.cfg ?? ''}
          onChange={e => patch(r => {r.engine.cfg = num(e.target.value);})} /></label>
      </div>
      <label className="check"><input type="checkbox" checked={custom} onChange={e => patch(r => {
        r.output.width = e.target.checked ? 1024 : null; r.output.height = e.target.checked ? 1024 : null;})} /> Tamanho personalizado</label>
      {custom && <div className="fields two">
        <label>Largura<input type="number" min={256} max={2048} step={32} value={request.output.width ?? ''} onChange={e => patch(r => {r.output.width = num(e.target.value);})} /></label>
        <label>Altura<input type="number" min={256} max={2048} step={32} value={request.output.height ?? ''} onChange={e => patch(r => {r.output.height = num(e.target.value);})} /></label>
      </div>}
      <label className="block">Prompt negativo (só tem efeito com CFG acima de 1)
        <textarea rows={2} value={request.engine.negative_prompt} disabled={(request.engine.cfg ?? 1) <= 1}
          onChange={e => patch(r => {r.engine.negative_prompt = e.target.value;})} /></label>
    </div>
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
    <div className="group" id="confirmations" tabIndex={-1}>
      <label className="check"><input type="checkbox" checked={request.content_mode === 'adult'} onChange={e => setAdult(e.target.checked)} /> Mostrar opções adultas (+18)</label>
      <p className="help">Só organiza a biblioteca. Não muda as instruções dos outros campos.</p>
      {request.content_mode === 'adult' && <>
        <label className="check"><input type="checkbox" checked={request.confirmations.includes('adults_only')}
          onChange={e => confirmation('adults_only', e.target.checked)} /> Confirmo que todas as pessoas retratadas são adultas.</label>
        {request.mode === 'edit' && <label className="check"><input type="checkbox" checked={request.confirmations.includes('consent_or_fictional')}
          onChange={e => confirmation('consent_or_fictional', e.target.checked)} /> Confirmo que a pessoa da foto é fictícia ou consentiu com esta edição.</label>}
      </>}
    </div>
  );
}
