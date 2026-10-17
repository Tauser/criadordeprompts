import {useEffect} from 'react';
import type {Category, LibrarySnapshot, Prepared, StudioRequest} from '../api/types';
import type {Workspace} from '../state/workspace';
import {Icon} from './Icon';
import {PromptPreview} from './PromptPreview';

export type SettingsTab = 'prompt' | 'advanced';
type Patch = (fn: (r: StudioRequest) => void) => void;

interface Props {
  tab: SettingsTab; onTab: (t: SettingsTab) => void; onClose: () => void;
  request: StudioRequest; prepared: Prepared | null; pending: boolean; error: string | null; library: LibrarySnapshot;
  patch: Patch; update: (fn: (ws: Workspace) => Workspace) => void;
  onManual: (enabled: boolean) => void; onFocusIssue: (field: string) => void;
}

export function Settings({tab, onTab, onClose, request, prepared, pending, error, library, patch, update, onManual, onFocusIssue}: Props) {
  const errorCount = prepared?.issues.filter(i => i.level === 'error').length ?? 0;
  useEffect(() => {
    const key = (event: KeyboardEvent) => {if (event.key === 'Escape') {event.stopPropagation(); onClose();}};
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <div className="scrim side" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Prompt e ajustes">
        <header className="drawer-head">
          <div className="segmented" role="tablist" aria-label="Painel">
            <button role="tab" aria-selected={tab === 'prompt'} onClick={() => onTab('prompt')}>Prompt
              {errorCount > 0 && <span className="count bad">{errorCount}</span>}</button>
            <button role="tab" aria-selected={tab === 'advanced'} onClick={() => onTab('advanced')}>Ajustes</button>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Fechar painel"><Icon name="close" size={18} /></button>
        </header>
        <div className="drawer-body">
          {tab === 'prompt'
            ? <PromptPreview request={request} prepared={prepared} pending={pending} error={error} onManual={onManual}
                onManualText={text => patch(r => {r.manual_prompt = text;})} onFocusField={onFocusIssue} />
            : <Advanced request={request} patch={patch} library={library} update={update} />}
        </div>
      </aside>
    </div>
  );
}

function Advanced({request, patch, library, update}: {request: StudioRequest; patch: Patch; library: LibrarySnapshot;
  update: (fn: (ws: Workspace) => Workspace) => void}) {
  const edit = request.mode === 'edit';
  const manual = request.prompt_mode === 'manual';
  const turbo = request.output.profile === 'turbo';
  const custom = request.output.width != null;
  const num = (v: string) => v === '' ? null : Number(v);
  const people = (v: string) => v === '' ? null : Math.max(0, Math.min(10, Number(v)));
  const supports = request.context.supports;
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
    <div className="settings">
      <section className="setting-group">
        <h3>Detalhes extras</h3>
        <p className="help">Texto livre em inglês, enviado como está depois das escolhas.</p>
        <textarea rows={3} value={request.details} maxLength={4000} disabled={manual} aria-label="Detalhes extras em inglês"
                  placeholder="Ex.: a blue ceramic mug on the table" onChange={e => patch(r => {r.details = e.target.value;})} />
      </section>

      <section className="setting-group">
        <h3>Resultado</h3>
        <Switch label="Conferir cada imagem" hint="O modelo local avalia se o pedido foi atendido e escolhe a melhor."
                checked={request.output.verify} onChange={v => patch(r => {r.output.verify = v;})} />
        <Switch label="Aprimorar o prompt" hint="Reescreve o pedido antes de gerar; você revisa antes de usar." disabled={turbo}
                checked={request.output.refine} onChange={v => patch(r => {r.output.refine = v;})} />
      </section>

      <section className="setting-group">
        <h3>Pessoas e enquadramento</h3>
        <div className="fields two">
          <label>Pessoas na imagem<input type="number" min={1} max={10} placeholder="Livre" value={request.participants.requested ?? ''}
            onChange={e => patch(r => {r.participants.requested = people(e.target.value) || null;})} /></label>
          {edit && <label>Pessoas na foto<input type="number" min={0} max={10} placeholder="Não informado" value={request.participants.existing ?? ''}
            onChange={e => patch(r => {r.participants.existing = people(e.target.value);})} /></label>}
          {edit && <label>Enquadramento da foto<select value={request.context.original_framing ?? ''}
            onChange={e => patch(r => {r.context.original_framing = (e.target.value || null) as StudioRequest['context']['original_framing'];})}>
            <option value="">Não informado</option><option value="wide">Plano aberto</option><option value="full">Corpo inteiro</option>
            <option value="half">Meio corpo</option><option value="portrait">Rosto e ombros</option></select></label>}
        </div>
        {edit && <>
          <Switch label="Permitir reenquadrar" checked={request.context.allow_reframing} onChange={v => patch(r => {r.context.allow_reframing = v;})} />
          <Switch label="Sei quais apoios existem na foto" checked={supports != null} onChange={v => patch(r => {r.context.supports = v ? [] : null;})} />
          {supports != null && <div className="choice-row">{(['bed', 'floor', 'seat', 'table', 'wall'] as const).map(s => (
            <button key={s} className={'choice' + (supports.includes(s) ? ' on' : '')} aria-pressed={supports.includes(s)} onClick={() => patch(r => {
              const set = new Set(r.context.supports ?? []); if (set.has(s)) set.delete(s); else set.add(s); r.context.supports = [...set];
            })}>{({floor: 'Chão', seat: 'Assento', bed: 'Cama', wall: 'Parede', table: 'Mesa'})[s]}</button>))}</div>}
          <Switch label="Permitir acrescentar apoios" hint="Para poses que precisam de cadeira, cama ou parede." checked={request.context.allow_new_supports}
                  onChange={v => patch(r => {r.context.allow_new_supports = v;})} />
        </>}
      </section>

      <section className="setting-group">
        <h3>Motor</h3>
        <div className="fields three">
          <label>Seed<input type="number" min={0} placeholder="Aleatória" value={request.output.seed ?? ''}
            onChange={e => patch(r => {r.output.seed = num(e.target.value);})} /></label>
          <label>Passos<input type="number" min={1} max={100} disabled={turbo} placeholder="40" value={request.engine.steps ?? ''}
            onChange={e => patch(r => {r.engine.steps = num(e.target.value);})} /></label>
          <label>CFG<input type="number" min={1} max={20} step={0.1} disabled={turbo} placeholder="1" value={request.engine.cfg ?? ''}
            onChange={e => patch(r => {r.engine.cfg = num(e.target.value);})} /></label>
        </div>
        <Switch label="Tamanho personalizado" checked={custom} onChange={v => patch(r => {r.output.width = v ? 1024 : null; r.output.height = v ? 1024 : null;})} />
        {custom && <div className="fields two">
          <label>Largura<input type="number" min={256} max={2048} step={32} value={request.output.width ?? ''} onChange={e => patch(r => {r.output.width = num(e.target.value);})} /></label>
          <label>Altura<input type="number" min={256} max={2048} step={32} value={request.output.height ?? ''} onChange={e => patch(r => {r.output.height = num(e.target.value);})} /></label>
        </div>}
        <label><span>Prompt negativo <span className="muted">(só com CFG acima de 1)</span></span>
          <textarea rows={2} value={request.engine.negative_prompt} disabled={(request.engine.cfg ?? 1) <= 1}
            onChange={e => patch(r => {r.engine.negative_prompt = e.target.value;})} /></label>
      </section>

      <section className="setting-group" id="confirmations" tabIndex={-1}>
        <h3>Conteúdo</h3>
        <Switch label="Mostrar opções +18 na biblioteca" hint="Só organiza a biblioteca. Não muda as outras instruções."
                checked={request.content_mode === 'adult'} onChange={setAdult} />
        {request.content_mode === 'adult' && <>
          <Switch label="Todas as pessoas retratadas são adultas" checked={request.confirmations.includes('adults_only')}
                  onChange={v => confirmation('adults_only', v)} />
          {edit && <Switch label="A pessoa da foto é fictícia ou consentiu com esta edição" checked={request.confirmations.includes('consent_or_fictional')}
                  onChange={v => confirmation('consent_or_fictional', v)} />}
        </>}
      </section>
    </div>
  );
}

function Switch({label, hint, checked, disabled, onChange}: {label: string; hint?: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void}) {
  return (
    <label className={'switch' + (disabled ? ' disabled' : '')}>
      <span className="switch-text"><span>{label}</span>{hint && <small>{hint}</small>}</span>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />
      <span className="switch-track" aria-hidden="true" />
    </label>
  );
}
