import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ApiError, api} from '../api/client';
import type {Attribute, Category, Issue, LibrarySnapshot, Prepared, Run, StudioRequest} from '../api/types';
import {ADVANCED, BASIC, FRAMING_LABELS, RUN_STATUS, TERMINAL} from '../lib/labels';
import {formatSeconds, runProgress} from '../lib/progress';
import {useCollapsed} from '../lib/useCollapsed';
import {load, save} from '../lib/storage';
import {usePeopleCount, type PeopleDetection} from '../lib/usePeopleCount';
import {useRun} from '../lib/useRun';
import {uuid} from '../lib/uuid';
import {addReference, applySuggestion, enterManual, filesForSubmit, initialWorkspace, leaveManual, removeReference,
  requestForSubmit, setAttribute, setTarget, switchMode, syncAuto, type Workspace} from '../state/workspace';
import {AttributeField} from './AttributeField';
import {CollapseButton} from './Collapse';
import {CompareGrid, startComparison, type ComparePlan, type GridCell} from './CompareGrid';
import {Disclosure, Segmented, Switch, Tip} from './Controls';
import {Icon} from './Icon';
import {History} from './History';
import {PromptPreview, SETUP_STEPS, setupIssues} from './PromptPreview';
import {References} from './References';
import {RunPanel, useNow} from './RunPanel';
import {TranslateButton} from './Translate';

type Drafts = Record<'generate' | 'edit', Workspace>;
const DRAFTS_KEY = 'prisma.drafts.v1', ACTIVE_KEY = 'prisma.active-run', PENDING_KEY = 'prisma.pending-request', GRID_KEY = 'prisma.compareGrid';
// Drafts saved before the rename are read once from the old keys.
const LEGACY = {drafts: 'kppb.drafts.v1', active: 'kppb.active-run'};

interface Props {library: LibrarySnapshot; comfyOnline: boolean; notify: (m: string, e?: boolean) => void}

// A submission whose answer never arrived. The same logical attempt keeps its id, so sending it again
// (or finding it later) can never create a second run on the server.
interface PendingSubmit {id: string; fingerprint: string}
const loadPending = (): PendingSubmit | null => {
  const value = load<PendingSubmit | string | null>(PENDING_KEY, null);
  return typeof value === 'string' ? {id: value, fingerprint: ''} : value;
};
const filesOf = (ws: Workspace) => [...Object.values(ws.files).map(f => f.hash), ...(ws.maskHash ? [ws.maskHash] : [])];

export function Studio({library, comfyOnline, notify}: Props) {
  const stored = load<{mode: 'generate' | 'edit'; drafts: Drafts} | null>(DRAFTS_KEY, null)
    ?? load<{mode: 'generate' | 'edit'; drafts: Drafts} | null>(LEGACY.drafts, null);
  const [drafts, setDrafts] = useState<Drafts>(stored?.drafts ?? {generate: initialWorkspace('generate'), edit: initialWorkspace('edit')});
  const [workspace, setWorkspace] = useState<Workspace>(stored ? stored.drafts[stored.mode] : initialWorkspace('generate'));
  const [tab, setTab] = useState<'basic' | 'advanced'>('basic');
  const [reveal, setReveal] = useState<{block: string; n: number}>({block: '', n: 0});
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [preparedFor, setPreparedFor] = useState<Workspace | null>(null);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pendingSubmit, setPendingSubmit] = useState<PendingSubmit | null>(loadPending);
  const [reconcile, setReconcile] = useState(0);
  const inFlight = useRef(false);
  const [activeRun, setActiveRun] = useState<string | null>(load<string | null>(ACTIVE_KEY, null) ?? load<string | null>(LEGACY.active, null));
  const [grid, setGrid] = useState<GridCell[] | null>(() => {const saved = load<GridCell[] | null>(GRID_KEY, null); return Array.isArray(saved) ? saved : null;});
  const {run, connection} = useRun(activeRun);
  const epoch = useRef(0);
  const autoMade = useRef<{ws: Workspace | null; count: number}>({ws: null, count: 0});
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

  const markPending = (marker: PendingSubmit | null) => {save(PENDING_KEY, marker); setPendingSubmit(marker);};

  // Recover a submission whose answer never arrived (network drop, closed tab): keep asking the server
  // until it says, one way or the other, whether the request arrived.
  useEffect(() => {
    if (!pendingSubmit || inFlight.current) return;
    let stopped = false, timer: number | undefined;
    const check = async () => {
      try {
        const found = await api.runByRequest(pendingSubmit.id);
        if (stopped) return;
        setActiveRun(found.id); markPending(null);
        notify('O pedido anterior chegou ao Studio e está sendo acompanhado.');
      } catch (error) {
        if (stopped) return;
        // A timed-out POST may still be committing when this GET returns 404. Keep its ID for retries.
        timer = window.setTimeout(check, 3000);
      }
    };
    check();
    return () => {stopped = true; window.clearTimeout(timer);};
  }, [pendingSubmit, reconcile, notify]);

  useEffect(() => {
    const token = ++epoch.current;
    setPending(true);
    const timer = window.setTimeout(async () => {
      try {
        const result = await api.prepare(requestForSubmit(workspace));
        if (token !== epoch.current) return;
        setPrepared(result); setPreparedFor(workspace); setPrepareError(null);
        // Fields still at their default take the values the pose or action needs; a newer edit wins.
        // A chain of fills with no change by the person in between stops after three: never a loop.
        update(ws => {
          if (ws !== workspace) return ws;
          const chain = autoMade.current.ws === ws ? autoMade.current.count : 0;
          if (chain >= 3) return ws;
          const next = syncAuto(ws, result.suggestions ?? []);
          if (next !== ws) autoMade.current = {ws: next, count: chain + 1};
          return next;
        });
      } catch (error) {
        if (token !== epoch.current) return;
        const issues = error instanceof ApiError && error.status === 422 ? (error.body.issues ?? []) as Issue[] : [];
        if (issues.length) {           // contract errors name their fields: show them like the other issues
          setPrepared({valid: false, status: 'incompatible', issues, slots: {}, prompt: null, segments: [], checks: []});
          setPreparedFor(workspace); setPrepareError(null);
        } else {
          setPrepared(null);
          setPrepareError(error instanceof ApiError && error.status === 422
            ? 'Há campos com valores vazios ou fora do permitido.' : (error as Error).message);
        }
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

  // "Pessoas na foto" is filled from the faces found in the photo being edited, until the user types a number.
  const targetHash = request.mode === 'edit' && request.target_id ? workspace.files[request.target_id]?.hash ?? null : null;
  const detection = usePeopleCount(targetHash, request.participants.existing == null, comfyOnline, (hash, count) =>
    update(ws => {
      const current = ws.request.target_id ? ws.files[ws.request.target_id]?.hash : null;
      if (current !== hash || ws.request.participants.existing != null) return ws;
      const next = structuredClone(ws);
      next.request.participants.existing = count; next.existingFrom = hash;
      return next;
    }));

  const busy = !!run && !TERMINAL.has(run.status);
  const changeMode = (mode: 'generate' | 'edit') => {
    if (mode === request.mode) return;
    const result = switchMode(drafts, workspace, mode);
    setDrafts(result.drafts); setWorkspace(result.workspace);
  };
  const itemsFor = (category: Category) => library.items.filter(i => i.category === category && i.enabled
    && (request.content_mode === 'adult' || !i.adult));
  // Offered next to the field: what the pose, action or scene needs, unless the Studio already filled it with that value.
  const suggestionsFor = (category: Category) => (prepared?.suggestions ?? [])
    .filter(s => s.field === category && !(s.auto && workspace.auto?.[category]));
  const field = (category: Category) => (
    <AttributeField key={category} category={category} mode={request.mode} targetId={request.target_id}
      attribute={request.attributes[category] ?? {intent: 'free'}} items={itemsFor(category)} references={request.references}
      hiddenAdult={request.content_mode === 'adult' ? 0
        : library.items.filter(i => i.category === category && i.enabled && i.adult).length}
      disabled={request.prompt_mode === 'manual'} issues={issuesByField[`attributes.${category}`] ?? []}
      auto={workspace.auto?.[category]} suggestions={suggestionsFor(category)}
      onSuggest={suggestion => update(ws => applySuggestion(ws, suggestion))}
      onChange={(attribute: Attribute) => update(ws => setAttribute(ws, category, attribute))}>
      {category === 'wardrobe' && request.attributes.wardrobe?.intent === 'set' && (
        <div className="field-extra">
          <span className="control-label">Aplicar roupa a
            <Tip>Para aplicar a todos, informe duas ou mais pessoas em Avançado → Cena ou adicione outro personagem.</Tip></span>
          <Segmented small label="Aplicar roupa a" value={request.wardrobe_scope ?? 'primary'} disabled={request.prompt_mode === 'manual'}
            options={[{value: 'primary', label: 'Pessoa principal'}, {value: 'all', label: 'Todas as pessoas'}]}
            onChange={value => patch(r => {r.wardrobe_scope = value;})} />
        </div>
      )}
    </AttributeField>
  );

  // Every way of sending (button, shortcut, repeat) goes through here: one request at a time, and the same
  // logical attempt reuses its id until the server answers.
  const send = async (fingerprint: string, call: (requestId: string) => Promise<Run>, done?: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    const marker = {id: pendingSubmit?.fingerprint === fingerprint ? pendingSubmit.id : uuid(), fingerprint};
    markPending(marker);
    setSubmitting(true);
    try {
      const created = await call(marker.id);
      setActiveRun(created.id);
      markPending(null);
      if (done) notify(done);
    } catch (error) {
      if (error instanceof ApiError && error.status < 500 && error.status !== 408) {
        markPending(null); notify(error.message, true);
      }
      else {
        notify('Sem resposta do Studio. Ele será consultado até responder; enviar de novo não duplica o pedido.', true);
        inFlight.current = false;
        setReconcile(n => n + 1);
      }
    } finally {inFlight.current = false; setSubmitting(false);}
  };
  const submit = async () => {
    if (!prepared?.valid || pending || preparedFor !== workspace) {
      notify(pending || preparedFor !== workspace ? 'Aguarde a prévia do prompt ser atualizada.' : 'Corrija os erros antes de gerar.', true);
      return;
    }
    const body = {request: requestForSubmit(workspace), files: filesForSubmit(workspace), mask: request.mask ? workspace.maskHash : null};
    await send(JSON.stringify(body), requestId => api.createRun({request_id: requestId, ...body}));
  };
  const repeat = async (sameSeed: boolean, redo?: {profile: 'qwen21' | 'turbo'; seed: number}) => {
    if (!run) return;
    await send(`repeat:${run.id}:${sameSeed}:${redo ? `${redo.profile}:${redo.seed}` : ''}`,
      requestId => api.repeat(run.id, requestId, sameSeed, redo),
      redo ? 'Refazendo esta variação no perfil Completo.'
        : sameSeed ? 'Repetindo com a mesma seed.' : 'Gerando de novo com uma nova seed.');
  };
  // The grid is remembered until closed; each cell is followed by its run, so a reload picks it up again.
  const showGrid = (cells: GridCell[] | null) => {setGrid(cells); save(GRID_KEY, cells);};
  const compare = async (plan: ComparePlan) => {
    if (!run?.request || !run.files) return;
    const cells = await startComparison(run, plan, library.items, partial => showGrid(partial));
    showGrid(cells);
    const failed = cells.filter(c => c.error).length;
    notify(failed ? `${failed} de ${cells.length} gerações não foram enviadas.` : 'Grade enviada. Cada geração aparece abaixo.', failed > 0);
  };
  const stop = async () => {
    if (!activeRun) return;
    try {await api.cancel(activeRun);} catch (error) {notify((error as Error).message, true);}
  };
  const reuse = (hash: string) => {
    const base = request.mode === 'edit' ? workspace : drafts.edit;
    let next = base;
    if (next.request.target_id) next = removeReference(next, next.request.target_id);
    const id = 'ref-' + uuid().slice(0, 8);
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
    const block = /^(participants|context)/.test(path) ? 'scene' : /^(engine|output\.(width|height|seed))/.test(path) ? 'engine'
      : path === 'confirmations' ? 'content' : '';
    if (category) setTab(ADVANCED.includes(category) ? 'advanced' : 'basic');
    else if (block) {setTab('advanced'); setReveal(r => ({block, n: r.n + 1}));}
    else if (path === 'attributes') setTab('basic');
    const target = category ? `field-${category}` : path === 'attributes' ? `field-${BASIC[0]}` : path === 'confirmations' ? 'confirmations'
      : path === 'target_id' ? 'refs-title' : null;
    if (target) window.setTimeout(() => {
      const element = document.getElementById(target);
      element?.scrollIntoView?.({block: 'center', behavior: 'smooth'});
      element?.focus({preventScroll: true});
    }, 50);
  };
  // The draft of each mode is kept between visits; this starts the current mode over.
  const clearForm = () => {
    const label = request.mode === 'edit' ? 'Editar foto' : 'Criar imagem';
    if (!confirm(`Limpar o formulário de “${label}”? Campos, imagens, máscara e ajustes de saída voltam ao início.`)) return;
    setWorkspace(initialWorkspace(request.mode));
    setTab('basic');
  };
  const toggleManual =(enabled: boolean) => {
    if (enabled) update(ws => enterManual(ws, prepared?.prompt ?? ''));
    else if (request.manual_prompt === prepared?.prompt || confirm('Voltar aos campos descarta o texto manual. Continuar?')) update(leaveManual);
  };

  // Ctrl+Enter generates, Esc stops — the usual shortcuts of creative tools.
  const ready = !!prepared?.valid && preparedFor === workspace && !pending && !submitting && !busy;
  const shortcuts = useRef({submit, stop, busy, ready});
  shortcuts.current = {submit, stop, busy, ready};
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const s = shortcuts.current;
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {event.preventDefault(); if (s.ready) s.submit();}
      else if (event.key === 'Escape' && s.busy && !(event.target as HTMLElement)?.closest('.mask-editor')) s.stop();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const isSet = (c: Category) => {const a = request.attributes[c]; return !!a && a.intent !== 'free' && a.intent !== 'keep';};
  const basicCount = BASIC.filter(isSet).length;
  const advancedCount = ADVANCED.filter(isSet).length + (request.engine.loras?.length ? 1 : 0);
  const blockIssues = (pattern: RegExp) => Object.keys(issuesByField).some(k => pattern.test(k));
  const revealOf = (block: string) => reveal.block === block ? reveal.n : 0;

  // What the bar at the bottom says: the progress of the open run, or why generating is not possible yet.
  const now = useNow(busy);
  const progress = run && busy ? runProgress(run, now) : null;
  const missing = setupIssues(prepared?.issues ?? []);
  const conflicts = (prepared?.issues ?? []).filter(i => i.level === 'error').length - missing.length;
  const hint = !comfyOnline ? 'ComfyUI offline: o pedido fica na fila do Studio até ele voltar.'
    : run?.status === 'review' ? 'Revise o texto aprimorado no painel do resultado.'
    : progress ? [progress.detail || progress.label, formatSeconds(progress.elapsed)].filter(Boolean).join(' · ')
    : ready || submitting ? ''
    : pending || preparedFor !== workspace ? 'Atualizando a prévia do prompt…'
    : missing.length && request.mode === 'edit' ? `${SETUP_STEPS[missing[0].code]} para começar.`
    : conflicts > 0 ? (conflicts === 1 ? 'Resolva o conflito indicado no painel do Prompt.' : `Resolva os ${conflicts} conflitos indicados no painel do Prompt.`)
    : prepareError ?? '';

  return (
    <>
      <div className={'workspace' + (run ? ' has-run' : '')}>
        <div className="column form-column">
          <div className="mode-row">
            <div className="segmented mode-switch" role="radiogroup" aria-label="Modo">
              {(['generate', 'edit'] as const).map(mode => (
                <button key={mode} role="radio" aria-checked={request.mode === mode} className={request.mode === mode ? 'active' : ''}
                        onClick={() => changeMode(mode)}>{mode === 'generate' ? 'Criar imagem' : 'Editar foto'}</button>
              ))}
            </div>
            <button className="quiet" onClick={clearForm} title="Volta campos, imagens, máscara e saída deste modo ao início">
              <Icon name="refresh" size={14} />Limpar</button>
          </div>
          <References workspace={workspace} slots={prepared?.slots ?? {}} disabled={false} update={update} notify={notify} />
          <section className="card" aria-labelledby="ask-title">
            <div className="section-title">
              <h2 id="ask-title">{request.mode === 'edit' ? 'O que mudar' : 'O que pedir'}</h2>
              <div className="segmented tabs" role="tablist" aria-label="Campos">
                <button role="tab" id="tab-basic" aria-controls="panel-fields" aria-selected={tab === 'basic'} onClick={() => setTab('basic')}>
                  Básico{basicCount > 0 && <span className="tab-count" aria-label={`, ${basicCount} definidos`}>{basicCount}</span>}</button>
                <button role="tab" id="tab-advanced" aria-controls="panel-fields" aria-selected={tab === 'advanced'} onClick={() => setTab('advanced')}>
                  Avançado{advancedCount > 0 && <span className="tab-count" aria-label={`, ${advancedCount} definidos`}>{advancedCount}</span>}</button>
              </div>
            </div>
            {tab === 'basic' ? (
              <div role="tabpanel" id="panel-fields" aria-labelledby="tab-basic">
                <div className="fields two">{BASIC.map(field)}</div>
                <div className="field">
                  <div className="field-label"><label htmlFor="details">Detalhes extras <span className="muted">· em inglês</span></label>
                    <Tip>Enviados como estão, depois das instruções dos campos. O texto dos campos não muda, mas um detalhe que os contradiga ainda pode influenciar a imagem.</Tip></div>
                  <textarea id="details" rows={3} value={request.details} maxLength={4000} disabled={request.prompt_mode === 'manual'}
                            placeholder="Ex.: a blue ceramic mug on the table" onChange={e => patch(r => {r.details = e.target.value;})} />
                  <TranslateButton label="os detalhes extras" text={request.details} disabled={request.prompt_mode === 'manual'}
                                   onTranslated={text => patch(r => {r.details = text;})} />
                </div>
              </div>
            ) : (
              <div role="tabpanel" id="panel-fields" aria-labelledby="tab-advanced">
                <h3 className="eyebrow">Aparência</h3>
                <div className="fields two">{ADVANCED.slice(0, 4).map(field)}</div>
                <h3 className="eyebrow">Câmera</h3>
                <div className="fields two">{ADVANCED.slice(4).map(field)}</div>
                <div className="disclosures">
                  <SceneContext request={request} patch={patch} reveal={revealOf('scene')} alert={blockIssues(/^(participants|context)/)}
                                people={prepared?.participants} detection={detection} detected={workspace.existingFrom === targetHash && !!targetHash}
                                issues={issuesByField} setExisting={value => update(ws => {
                                  const next = structuredClone(ws);
                                  next.request.participants.existing = value; next.existingFrom = null;
                                  return next;
                                })} />
                  <Engine request={request} patch={patch} reveal={revealOf('engine')} alert={blockIssues(/^(engine|output\.(width|height|seed))/)} />
                  <Content request={request} patch={patch} library={library} update={update} reveal={revealOf('content')} alert={blockIssues(/^confirmations/)} />
                </div>
              </div>
            )}
          </section>
          <OutputCard request={request} patch={patch} />
        </div>
        <div className="column side-column">
          <div className="stage-wrap">
            <RunPanel run={run} connection={connection} onReuse={reuse} notify={notify} onRepeat={repeat}
              items={library.items} onCompare={compare} />
            {grid && <CompareGrid cells={grid} onClose={() => showGrid(null)} />}
            <History activeRun={activeRun} onSelect={setActiveRun} notify={notify}
              keepFiles={[...new Set([...filesOf(workspace), ...filesOf(drafts[request.mode === 'edit' ? 'generate' : 'edit'])])]} />
          </div>
          <PromptPreview request={request} prepared={prepared} pending={pending} error={prepareError}
            onManual={toggleManual} onManualText={text => patch(r => {r.manual_prompt = text;})} onFocusField={focusField} />
        </div>
      </div>
      <footer className="execution-bar" aria-label="Execução">
        {progress && <span className="execution-progress" style={{width: `${Math.round(progress.fraction * 100)}%`}} aria-hidden="true" />}
        <div className="execution-info" aria-live="polite">
          <span className={'dot ' + (busy ? 'busy' : ready ? 'ok' : 'idle')} />
          {busy ? <strong>{RUN_STATUS[run!.status] ?? run!.status}</strong> : ready && <strong>Pronto para gerar</strong>}
          <span className="muted">{hint}</span>
        </div>
        {busy && <button className="btn-stop" disabled={run?.cancel_requested} onClick={stop} title="Parar (Esc)">
          <Icon name="stop" size={14} />{run?.cancel_requested ? 'Parando…' : 'Parar'}</button>}
        <button className="btn-generate" disabled={!ready} onClick={submit} title="Gerar (Ctrl+Enter)">
          <span>{submitting ? 'Enviando…' : request.mode === 'edit' ? 'Gerar edição' : 'Gerar imagem'}</span><kbd aria-hidden="true">Ctrl ↵</kbd></button>
      </footer>
    </>
  );
}

type Patch = (fn: (r: StudioRequest) => void) => void;

// Mirrors uses_person_photos in the backend rules: a photo supplies a person.
const usesPersonPhotos = (request: StudioRequest) => request.mode === 'edit' || (request.characters ?? []).length > 0
  || (['subject', 'face', 'body', 'skin', 'hair'] as const).some(c => request.attributes[c]?.intent === 'transfer');

const ASPECTS = ['3:4', '2:3', '1:1', '4:3', '3:2', '16:9', '9:16'] as const;
const aspectBox = (aspect: string) => {
  const [w, h] = aspect.split(':').map(Number);
  const scale = 14 / Math.max(w, h);
  return <i className="aspect-box" style={{width: Math.round(w * scale), height: Math.round(h * scale)}} aria-hidden="true" />;
};

function OutputCard({request, patch}: {request: StudioRequest; patch: Patch}) {
  const [collapsed, toggle] = useCollapsed('output');
  const output = request.output;
  const edit = request.mode === 'edit', custom = output.width != null;
  const turbo = output.profile === 'turbo';
  const face = output.face_detail == null ? 'auto' : output.face_detail ? 'on' : 'off';
  const resolution = request.mask ? 0 : output.resolution;
  const summary = [turbo ? 'Turbo' : 'Completa', custom && !request.mask ? `${output.width}×${output.height}` : resolution ? String(resolution) : 'Original',
    !edit && !custom ? output.aspect : null, `${output.variations} ${output.variations === 1 ? 'variação' : 'variações'}`].filter(Boolean).join(' · ');
  return (
    <section className={'card output-card collapsible' + (collapsed ? ' is-collapsed' : '')} aria-labelledby="output-title">
      <div className="section-title">
        <h2 id="output-title">Saída</h2>
        <span className="spacer" />
        {collapsed && <span className="collapsed-summary">{summary}</span>}
        <CollapseButton collapsed={collapsed} onToggle={toggle} controls="output-body" label="saída" />
      </div>
      {!collapsed && <div id="output-body" className="output-grid">
        <div className="control"><span className="control-label">Qualidade</span>
          <Segmented label="Qualidade" value={output.profile} onChange={value => patch(r => {r.output.profile = value; if (value === 'turbo') r.output.refine = false;})}
            options={[{value: 'qwen21', label: 'Completa · 40 passos'}, {value: 'turbo', label: 'Turbo · 8 passos'}]} />
          {!(turbo && output.variations === 4) && <button type="button" className="btn-link draft-preset"
            title="Gera 4 variações rápidas no Turbo para achar a direção; depois use Refazer no Completo na que ficar melhor."
            onClick={() => patch(r => {r.output.profile = 'turbo'; r.output.variations = 4; r.output.refine = false;})}>
            Rascunho: Turbo com 4 variações</button>}</div>
        <div className="control"><span className="control-label">Variações</span>
          <Segmented label="Variações" value={output.variations} onChange={value => patch(r => {r.output.variations = value;})}
            options={[1, 2, 3, 4].map(v => ({value: v, label: String(v)}))} /></div>
        {!edit && <div className="control wide"><span className="control-label">Formato
          {custom && <Tip>Com tamanho personalizado (Avançado → Parâmetros do modelo), o formato vem da largura e da altura.</Tip>}</span>
          <Segmented label="Formato" value={output.aspect} disabled={custom} onChange={value => patch(r => {r.output.aspect = value;})}
            options={ASPECTS.map(a => ({value: a, label: <>{aspectBox(a)}{a}</>}))} /></div>}
        <div className="control"><span className="control-label">Resolução
          {request.mask && <Tip>Com máscara, a edição usa o tamanho original da foto.</Tip>}</span>
          <Segmented label="Resolução" value={resolution} disabled={request.mask}
            onChange={value => patch(r => {r.output.resolution = value as StudioRequest['output']['resolution'];})}
            options={[...(edit ? [{value: 0, label: 'Original'}] : []), {value: 1024, label: '1024', title: 'Rápida'},
              {value: 1536, label: '1536'}, {value: 2048, label: '2048', title: 'Alta'}]} /></div>
        <div className="control"><span className="control-label">Detalhe dos rostos
          <Tip>Depois da imagem pronta, cada rosto pequeno é recortado, redesenhado em alta resolução e colado de volta: corrige olhos desnivelados ou de cores diferentes sem mudar a identidade.</Tip></span>
          <Segmented label="Detalhe dos rostos" value={face}
            onChange={value => patch(r => {r.output.face_detail = value === 'auto' ? null : value === 'on';})}
            options={[{value: 'auto', label: 'Auto · 2+ pessoas'}, {value: 'on', label: 'Sempre'}, {value: 'off', label: 'Nunca'}]} /></div>
        <div className="switches wide">
          <Switch checked={output.verify} onChange={on => patch(r => {r.output.verify = on;})}>
            <strong>Verificar o resultado</strong> <span className="muted">· o modelo local confere cada requisito</span></Switch>
          <Switch checked={output.refine} disabled={turbo} onChange={on => patch(r => {r.output.refine = on;})}>
            <strong>Aprimorar o prompt</strong> <span className="muted">· {turbo ? 'indisponível no Turbo' : 'você revisa o texto antes de gerar'}</span></Switch>
        </div>
      </div>}
    </section>
  );
}

interface BlockProps {request: StudioRequest; patch: Patch; reveal: number; alert: boolean}

function SceneContext({request, patch, reveal, alert, people, detection, detected, issues, setExisting}: BlockProps & {
  people?: Prepared['participants']; detection: PeopleDetection | null; detected: boolean; issues: Record<string, string[]>;
  setExisting: (value: number | null) => void;
}) {
  const edit = request.mode === 'edit';
  const supports = request.context.supports;
  const requested = request.participants.requested, existing = request.participants.existing;
  const automatic = people?.automatic ?? null, total = people?.total ?? requested ?? automatic;
  const plural = (n: number) => `${n} ${n === 1 ? 'pessoa' : 'pessoas'}`;
  // The photo's count matters only when the result has more than one person (people are added, never removed).
  const showExisting = edit && ((total ?? 0) > 1 || (existing != null && existing !== 1) || !!issues['participants.existing']);
  const summary = [total ? plural(total) + (requested ? '' : ' · automático') : 'pessoas livres',
    showExisting && existing != null ? `${existing} na foto` : null,
    edit && request.context.original_framing ? FRAMING_LABELS[request.context.original_framing] : null].filter(Boolean).join(' · ');
  const fieldIssues = (key: string) => issues[key]?.length
    ? <ul className="field-issues">{issues[key].map(m => <li key={m}>{m}</li>)}</ul> : null;
  const found = detection?.status === 'done' ? detection.count ?? 0 : null;
  return (
    <Disclosure title="Cena" summary={summary} reveal={reveal} alert={alert}>
      <div className="fields three">
        <div className="field">
          <label htmlFor="people-requested" title={automatic ? `Automático: ${plural(automatic)}, ${people?.reason}. Digite um número só para pedir outro total.`
            : 'Sem escolha que defina o número de pessoas: o modelo decide. Digite um número para fixar.'}>Pessoas no resultado</label>
          <input id="people-requested" type="number" min={1} max={10} value={requested ?? ''}
            placeholder={automatic ? `${automatic} · ${people?.reason}` : 'Automático'}
            onChange={e => patch(r => {r.participants.requested = e.target.value === '' ? null : Math.max(1, Math.min(10, Number(e.target.value))) || null;})} />
          {requested != null && <button type="button" className="quiet small" onClick={() => patch(r => {r.participants.requested = null;})}>
            Voltar ao automático</button>}
          {fieldIssues('participants.requested')}
        </div>
        {showExisting && <div className="field people-count">
          <span className="field-label" title="Quantas pessoas já aparecem na foto que será editada. O Studio mantém essas pessoas e acrescenta só as que faltam.">
            Pessoas na foto</span>
          <Segmented small label="Pessoas na foto" value={existing ?? -1} onChange={value => setExisting(value === existing ? null : value)}
            options={[0, 1, 2, 3, 4, 5, 6].map(n => ({value: n, label: String(n),
              title: n === 0 ? 'Nenhuma pessoa na foto (por exemplo, uma paisagem onde as pessoas serão acrescentadas)' : undefined}))} />
          {detection?.status === 'counting' && <span className="muted small">Contando os rostos da foto…</span>}
          {detected && <span className="muted small">Detectado na foto · confira</span>}
          {!detected && found != null && found > 0 && existing !== found && <button type="button" className="quiet small" onClick={() => setExisting(found)}>
            Usar o detectado ({found})</button>}
          {detection?.status === 'done' && found === 0 && existing == null && <span className="muted small">Nenhum rosto encontrado: escolha o número.</span>}
          {detection?.status === 'failed' && existing == null && <span className="muted small">{detection.error}</span>}
          {fieldIssues('participants.existing')}
        </div>}
        {edit && <label>Enquadramento da foto<select value={request.context.original_framing ?? ''}
          onChange={e => patch(r => {r.context.original_framing = (e.target.value || null) as StudioRequest['context']['original_framing'];})}>
          <option value="">Não informado</option><option value="full">Corpo inteiro</option><option value="half">Meio corpo</option>
          <option value="wide">Plano aberto</option><option value="portrait">Rosto e ombros</option></select></label>}
      </div>
      {edit && <div className="switches">
        <Switch checked={supports != null} onChange={on => patch(r => {r.context.supports = on ? [] : null;})}>Sei quais apoios existem na foto</Switch>
        {supports != null && <div className="checks">{(['floor', 'seat', 'bed', 'wall', 'table'] as const).map(s => (
          <label key={s} className="check"><input type="checkbox" checked={supports.includes(s)} onChange={e => patch(r => {
            const set = new Set(r.context.supports ?? []); if (e.target.checked) set.add(s); else set.delete(s); r.context.supports = [...set];
          })} /> {({floor: 'chão', seat: 'assento', bed: 'cama', wall: 'parede', table: 'mesa'})[s]}</label>))}</div>}
        <Switch checked={request.context.allow_new_supports} onChange={on => patch(r => {r.context.allow_new_supports = on;})}>Permitir acrescentar apoios necessários</Switch>
        <Switch checked={request.context.allow_reframing} onChange={on => patch(r => {r.context.allow_reframing = on;})}>Permitir reenquadrar</Switch>
      </div>}
    </Disclosure>
  );
}

function Engine({request, patch, reveal, alert}: BlockProps) {
  const turbo = request.output.profile === 'turbo';
  const num = (v: string) => v === '' ? null : Number(v);
  const custom = request.output.width != null && !request.mask;
  const cfg = request.engine.cfg ?? 1;
  const loras = request.engine.loras ?? [];
  const summary = [`seed ${request.output.seed ?? 'aleatória'}`, turbo ? '8 passos' : `${request.engine.steps ?? 40} passos`, `CFG ${cfg}`,
    custom ? `${request.output.width}×${request.output.height}` : null].filter(Boolean).join(' · ');
  return (<>
    <Disclosure title="Parâmetros do modelo" summary={summary} reveal={reveal} alert={alert}>
      <div className="fields three">
        <label>Seed<input type="number" min={0} placeholder="Aleatória" value={request.output.seed ?? ''}
          onChange={e => patch(r => {r.output.seed = num(e.target.value);})} /></label>
        <label>Passos<input type="number" min={1} max={100} disabled={turbo} placeholder="40" value={request.engine.steps ?? ''}
          onChange={e => patch(r => {r.engine.steps = num(e.target.value);})} /></label>
        <label>CFG<input type="number" min={1} max={20} step={0.1} disabled={turbo} placeholder="1" value={request.engine.cfg ?? ''}
          onChange={e => patch(r => {r.engine.cfg = num(e.target.value);})} /></label>
      </div>
      <p className="help">Para comparar ajustes, fixe a seed e mude um campo por vez. Mais passos ou CFG maior não garantem que a edição será atendida.</p>
      <Switch checked={custom} disabled={request.mask} onChange={on => patch(r => {
        r.output.width = on ? 1024 : null; r.output.height = on ? 1024 : null;})}>
        Tamanho personalizado{request.mask ? <span className="muted"> · indisponível com máscara</span> : null}</Switch>
      {custom && <div className="fields three">
        <label>Largura<input type="number" min={256} max={2048} step={32} value={request.output.width ?? ''} onChange={e => patch(r => {r.output.width = num(e.target.value);})} /></label>
        <label>Altura<input type="number" min={256} max={2048} step={32} value={request.output.height ?? ''} onChange={e => patch(r => {r.output.height = num(e.target.value);})} /></label>
      </div>}
      {cfg > 1 ? <>
        <label className="block">Prompt negativo
          <textarea rows={2} value={request.engine.negative_prompt} onChange={e => patch(r => {r.engine.negative_prompt = e.target.value;})} /></label>
        <TranslateButton label="o prompt negativo" text={request.engine.negative_prompt}
                         onTranslated={text => patch(r => {r.engine.negative_prompt = text;})} />
      </> : <p className="inline-note">O prompt negativo aparece com CFG acima de 1.</p>}
    </Disclosure>
    <Disclosure title="LoRA" summary={loras.length ? loras.map(l => `${l.name.replace(/\.safetensors$/, '')} ${l.strength}`).join(' · ') : 'nenhum'}>
      <Loras request={request} patch={patch} />
    </Disclosure>
  </>);
}

// LoRAs installed in ComfyUI, applied in order to the image model. Up to three; nothing is analysed by the rules.
function Loras({request, patch}: {request: StudioRequest; patch: Patch}) {
  const [installed, setInstalled] = useState<string[] | null>(null);
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    api.loras().then(r => {setInstalled(r.loras); setOffline(!r.available);}).catch(() => {setInstalled([]); setOffline(true);});
  }, []);
  const chosen = request.engine.loras ?? [];
  const set = (index: number, change: Partial<{name: string; strength: number}>) => patch(r => {
    r.engine.loras = (r.engine.loras ?? []).map((l, i) => i === index ? {...l, ...change} : l);
  });
  const add = () => patch(r => {r.engine.loras = [...(r.engine.loras ?? []), {name: installed?.[0] ?? '', strength: 0.8}];});
  const remove = (index: number) => patch(r => {r.engine.loras = (r.engine.loras ?? []).filter((_, i) => i !== index);});
  return (
    <div className="loras">
      {chosen.map((lora, index) => (
        <div key={index} className="fields three">
          <label>Arquivo<select value={lora.name} onChange={e => set(index, {name: e.target.value})}>
            {[...new Set([lora.name, ...(installed ?? [])])].filter(Boolean).map(n => <option key={n} value={n}>{n}</option>)}
          </select></label>
          <label>Força<input type="number" min={-2} max={2} step={0.05} value={lora.strength}
            onChange={e => set(index, {strength: Number(e.target.value)})} /></label>
          <button type="button" className="quiet" onClick={() => remove(index)} aria-label={`Remover LoRA ${lora.name}`}>Remover</button>
        </div>))}
      {chosen.length < 3 && <button type="button" className="quiet" disabled={!installed?.length} onClick={add}>Adicionar LoRA</button>}
      <p className="help">{offline ? 'ComfyUI offline: a lista de LoRAs aparece quando ele voltar.'
        : installed && !installed.length ? 'Nenhum LoRA instalado em ComfyUI\\models\\loras.'
        : 'Use só LoRAs treinados para o Qwen Image 2.1. Comece com força entre 0,4 e 0,8 e compare com e sem, na mesma seed.'}</p>
    </div>
  );
}

function Content({request, patch, library, update, reveal, alert}: BlockProps & {library: LibrarySnapshot;
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
    <Disclosure title="Conteúdo" summary={request.content_mode === 'adult' ? 'opções adultas (+18)' : 'padrão'} reveal={reveal} alert={alert}>
      <div id="confirmations" tabIndex={-1} className="switches">
      <Switch checked={request.content_mode === 'adult'} onChange={setAdult}>Mostrar opções adultas (+18)
        <Tip>Só organiza a biblioteca. Não muda as instruções dos outros campos.</Tip></Switch>
      {request.content_mode === 'adult' && <>
        <label className="check"><input type="checkbox" checked={request.confirmations.includes('adults_only')}
          onChange={e => confirmation('adults_only', e.target.checked)} /> Confirmo que todas as pessoas retratadas são adultas.</label>
        {usesPersonPhotos(request) && <label className="check"><input type="checkbox" checked={request.confirmations.includes('consent_or_fictional')}
          onChange={e => confirmation('consent_or_fictional', e.target.checked)} /> Confirmo que as pessoas das fotos são fictícias ou consentiram com este uso.</label>}
      </>}
      </div>
    </Disclosure>
  );
}
