import {useEffect, useRef, useState, type DragEvent} from 'react';
import {api, fileUrl} from '../api/client';
import type {Attribute, Category, LibrarySnapshot, Prepared, Run, StudioRequest} from '../api/types';
import {CATEGORY_LABELS, PHASE, RUN_STATUS} from '../lib/labels';
import {sortBy} from '../lib/sort';
import {ROLES, addReference, applyReference, referenceRoles, removeReference, setTarget, type Workspace} from '../state/workspace';
import {Icon} from './Icon';
import {MaskEditor} from './MaskEditor';
import type {SettingsTab} from './Settings';

interface Props {
  workspace: Workspace; prepared: Prepared | null; pending: boolean; errorCount: number; busy: boolean; submitting: boolean;
  run: Run | null; comfyOnline: boolean; library: LibrarySnapshot;
  update: (next: Workspace | ((ws: Workspace) => Workspace)) => void;
  patch: (fn: (r: StudioRequest) => void) => void;
  notify: (m: string, e?: boolean) => void;
  onMode: (mode: 'generate' | 'edit') => void; onPick: (category: Category) => void;
  onField: (category: Category, attribute: Attribute) => void;
  onSubmit: () => void; onStop: () => void; onSettings: (tab: SettingsTab) => void; onOpenRun: () => void;
}

// Order in which chips appear: the scene reads like a sentence (who, where, doing what, how it looks).
export const CHIP_ORDER: Category[] = ['subject', 'face', 'body', 'skin', 'hair', 'wardrobe', 'pose', 'action', 'expression',
  'environment', 'lighting', 'style', 'camera', 'framing'];
const SUGGESTED: Category[] = ['subject', 'environment', 'pose', 'lighting', 'style'];

export function attributeText(attribute: Attribute | undefined, library: LibrarySnapshot, request: StudioRequest): string | null {
  if (!attribute) return null;
  if (attribute.intent === 'set' && attribute.value?.kind === 'catalog') {
    const id = attribute.value.item_id;
    return library.items.find(i => i.id === id)?.label ?? 'Opção indisponível';
  }
  if (attribute.intent === 'set' && attribute.value?.kind === 'text') return attribute.value.text.trim() || 'Descrição vazia';
  if (attribute.intent === 'transfer') return 'Da imagem ' + (request.references.find(r => r.id === attribute.reference_id)?.label ?? '?');
  if (attribute.intent === 'free' && request.mode === 'edit') return 'O modelo decide';
  return null;
}

export function Composer(props: Props) {
  const {workspace, prepared, pending, errorCount, busy, submitting, run, comfyOnline, library, update, patch, notify} = props;
  const request = workspace.request;
  const edit = request.mode === 'edit';
  const manual = request.prompt_mode === 'manual';
  const [uploading, setUploading] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [masking, setMasking] = useState(false);
  const [dragging, setDragging] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (event: MouseEvent) => {if (!menuRef.current?.contains(event.target as Node)) setMenu(null);};
    const key = (event: KeyboardEvent) => {if (event.key === 'Escape') setMenu(null);};
    window.addEventListener('mousedown', close); window.addEventListener('keydown', key);
    return () => {window.removeEventListener('mousedown', close); window.removeEventListener('keydown', key);};
  }, [menu]);

  const add = async (files: FileList | File[] | null) => {
    const list = Array.from(files ?? []).filter(f => /^image\/(png|jpeg|webp)$/.test(f.type));
    if (!list.length) return;
    setUploading(true);
    try {
      for (const file of list) {
        const stored = await api.upload(file, file.name);
        const id = 'ref-' + crypto.randomUUID().slice(0, 8);
        update(ws => addReference(ws, id, {hash: stored.hash, width: stored.width, height: stored.height, name: file.name}));
      }
    } catch (error) {notify((error as Error).message, true);} finally {setUploading(false);}
  };
  const act = (fn: (ws: Workspace) => Workspace) => {
    try {update(fn); setMenu(null);} catch (error) {notify((error as Error).message, true);}
  };
  const saveMask = async (blob: Blob) => {
    try {
      const stored = await api.upload(blob, 'mascara.png');
      update(ws => ({...ws, maskHash: stored.hash, request: {...ws.request, mask: true}}));
      setMasking(false);
    } catch (error) {notify((error as Error).message, true);}
  };
  const drop = (event: DragEvent) => {
    event.preventDefault(); setDragging(false);
    add(event.dataTransfer.files);
  };

  const chips = CHIP_ORDER.map(category => ({category, text: attributeText(request.attributes[category], library, request)}))
    .filter((c): c is {category: Category; text: string} => c.text !== null);
  const issueCategories = new Set((prepared?.issues ?? []).filter(i => i.field.startsWith('attributes.')).map(i => i.field.split('.')[1]));
  const remove = (category: Category) => props.onField(category, edit ? {intent: 'keep'} : {intent: 'free'});
  const target = request.target_id ? workspace.files[request.target_id] : null;
  const live = run?.tasks?.find(t => t.status === 'running')?.live;
  const status = busy && run
    ? (live?.phase ? PHASE[live.phase] ?? live.phase : RUN_STATUS[run.status] ?? run.status) + (live?.value != null && live.maximum ? ` · ${live.value}/${live.maximum}` : '')
    : pending ? 'Atualizando…' : errorCount ? `${errorCount} ${errorCount === 1 ? 'erro' : 'erros'} para corrigir`
    : prepared ? (prepared.status === 'compatible' ? 'Pronto para gerar' : 'Pronto · revise os avisos') : 'Monte a cena';
  const tone = busy ? 'busy' : errorCount ? 'bad' : prepared && prepared.status !== 'compatible' ? 'warn' : 'ok';
  const progress = busy && live?.value != null && live.maximum ? live.value / live.maximum : null;

  return (
    <div className={'composer-dock' + (busy ? ' is-busy' : '')}>
      <section className={'composer' + (dragging ? ' dragging' : '')} aria-label="Compositor"
               onDragOver={e => {e.preventDefault(); setDragging(true);}} onDragLeave={() => setDragging(false)} onDrop={drop}>
        <div className="composer-progress" aria-hidden="true" style={progress != null ? {['--p' as string]: progress} : undefined} />
        <header className="composer-head">
          <div className="segmented" role="radiogroup" aria-label="Modo">
            {(['generate', 'edit'] as const).map(mode => (
              <button key={mode} role="radio" aria-checked={request.mode === mode} onClick={() => props.onMode(mode)}>
                {mode === 'generate' ? 'Criar imagem' : 'Editar foto'}</button>
            ))}
          </div>
          <button className={'composer-status ' + tone} onClick={() => busy ? props.onOpenRun() : props.onSettings('prompt')}
                  aria-live="polite" title={busy ? 'Acompanhar o pedido' : 'Ver o prompt e os avisos'}>
            <span className="dot" />{status}
          </button>
          {!comfyOnline && <span className="composer-note">ComfyUI offline: o pedido espera na fila</span>}
          <div className="composer-tools">
            <button className="icon-btn" onClick={() => props.onSettings('prompt')} aria-label="Prompt" title="Prompt">
              <Icon name="text" size={17} />{errorCount > 0 && <span className="badge-dot" />}</button>
            <button className="icon-btn" onClick={() => props.onSettings('advanced')} aria-label="Ajustes avançados" title="Ajustes avançados">
              <Icon name="sliders" size={17} /></button>
          </div>
        </header>

        <div className="composer-body">
          <div className="sources" aria-label={edit ? 'Foto e referências' : 'Referências'}>
            {request.references.map(ref => {
              const file = workspace.files[ref.id];
              const isTarget = ref.id === request.target_id;
              const roles = referenceRoles(workspace, ref.id);
              return (
                <div key={ref.id} className="source" ref={menu === ref.id ? menuRef : undefined}>
                  <button className={'source-thumb' + (isTarget ? ' target' : '') + (roles.length ? ' used' : '')}
                          aria-haspopup="menu" aria-expanded={menu === ref.id} onClick={() => setMenu(menu === ref.id ? null : ref.id)}
                          title={isTarget ? 'Foto que será editada' : roles.length ? 'Fornece: ' + roles.map(r => CATEGORY_LABELS[r]).join(', ') : ref.label}>
                    {file ? <img src={fileUrl(file.hash)} alt={ref.label} /> : <span>?</span>}
                    {isTarget && <span className="source-tag">Foto</span>}
                    {!isTarget && roles.length > 0 && <span className="source-tag">{roles.length === 1 ? CATEGORY_LABELS[roles[0]] : `${roles.length} usos`}</span>}
                    {isTarget && request.mask && <span className="source-mask" title="Edita só a área marcada"><Icon name="mask" size={11} /></span>}
                  </button>
                  {menu === ref.id && (
                    <div className="popover source-menu" role="menu">
                      <p className="popover-title">{isTarget ? 'Foto que será editada' : ref.label}</p>
                      {!isTarget && <>
                        <p className="popover-label">Usar desta imagem</p>
                        <div className="role-grid">
                          {sortBy(Object.entries(ROLES), ([, role]) => role.label).map(([key, role]) => (
                            <button key={key} role="menuitem" className={role.categories.every(c => roles.includes(c)) ? 'on' : ''}
                                    disabled={manual} onClick={() => act(ws => applyReference(ws, ref.id, key))}>{role.label}</button>
                          ))}
                        </div>
                      </>}
                      {isTarget && <button role="menuitem" className="menu-row" onClick={() => {setMenu(null); setMasking(true);}}>
                        <Icon name="mask" size={15} />{request.mask ? 'Redesenhar a área editada' : 'Editar só uma área'}</button>}
                      {isTarget && request.mask && <button role="menuitem" className="menu-row"
                        onClick={() => {update(ws => ({...ws, maskHash: null, request: {...ws.request, mask: false}})); setMenu(null);}}>
                        <Icon name="image" size={15} />Editar a foto inteira</button>}
                      {edit && !isTarget && <button role="menuitem" className="menu-row"
                        onClick={() => confirm('Usar esta imagem como a foto editada? Ela deixará de fornecer atributos.') && act(ws => setTarget(ws, ref.id))}>
                        <Icon name="edit" size={15} />Editar esta foto</button>}
                      <button role="menuitem" className="menu-row danger"
                        onClick={() => (!roles.length && !isTarget || confirm('Remover esta imagem? As escolhas anteriores serão restauradas.')) && act(ws => removeReference(ws, ref.id))}>
                        <Icon name="trash" size={15} />Remover</button>
                    </div>
                  )}
                </div>
              );
            })}
            {request.references.length < 10 && (
              <label className={'source-add' + (uploading ? ' busy' : '') + (edit && !target ? ' wide' : '')}
                     title="Adicionar imagens (ou arraste para cá)">
                <Icon name="plus" size={16} />
                {edit && !target ? <span>Escolher foto</span> : <span className="sr-only">Adicionar imagens</span>}
                <input type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={uploading} aria-label="Adicionar imagens"
                       onChange={e => {add(e.target.files); e.target.value = '';}} />
              </label>
            )}
          </div>

          <div className="prompt-line">
            {manual ? (
              <button className="manual-note" onClick={() => props.onSettings('prompt')}>
                <Icon name="text" size={15} /> Prompt escrito à mão. Toque para editar.</button>
            ) : <>
              {chips.map(({category, text}) => (
                <span key={category} className={'tag' + (issueCategories.has(category) ? ' has-issue' : '')}>
                  <button className="tag-main" onClick={() => props.onPick(category)} title={text}>
                    <span className="tag-key">{CATEGORY_LABELS[category]}</span><span className="tag-value">{text}</span>
                  </button>
                  <button className="tag-x" aria-label={`Remover ${CATEGORY_LABELS[category]}`} onClick={() => remove(category)}>
                    <Icon name="close" size={12} /></button>
                </span>
              ))}
              {!chips.length && <span className="prompt-placeholder">
                {edit ? (target ? 'O que você quer mudar na foto?' : 'Escolha a foto que será editada') : 'Descreva a cena:'}</span>}
              {!chips.length && SUGGESTED.map(category => (
                <button key={category} className="tag ghost" onClick={() => props.onPick(category)}>
                  <Icon name="plus" size={12} />{CATEGORY_LABELS[category]}</button>
              ))}
              {chips.length > 0 && <button className="tag add" onClick={() => props.onPick(CHIP_ORDER.find(c => !chips.some(x => x.category === c)) ?? 'subject')}>
                <Icon name="plus" size={13} />Adicionar</button>}
            </>}
          </div>
        </div>

        <footer className="composer-foot">
          <div className="pills">
            {!edit && <label className="pill" title="Formato"><span className="sr-only">Formato</span>
              <select aria-label="Formato" value={request.output.aspect} disabled={request.output.width != null}
                      onChange={e => patch(r => {r.output.aspect = e.target.value as StudioRequest['output']['aspect'];})}>
                {['3:4', '2:3', '1:1', '4:3', '3:2', '16:9', '9:16'].map(a => <option key={a} value={a}>{a}</option>)}</select></label>}
            <label className="pill" title="Resolução">
              <select aria-label="Resolução" value={request.output.resolution} disabled={request.mask}
                      onChange={e => patch(r => {r.output.resolution = Number(e.target.value) as StudioRequest['output']['resolution'];})}>
                {edit && <option value={0}>Tamanho da foto</option>}
                <option value={1024}>1024 px</option><option value={1536}>1536 px</option><option value={2048}>2048 px</option></select></label>
            <label className="pill" title="Variações">
              <select aria-label="Variações" value={request.output.variations} onChange={e => patch(r => {r.output.variations = Number(e.target.value);})}>
                {[1, 2, 3, 4].map(v => <option key={v} value={v}>{v === 1 ? '1 imagem' : `${v} imagens`}</option>)}</select></label>
            <label className="pill" title="Qualidade">
              <select aria-label="Qualidade" value={request.output.profile}
                      onChange={e => patch(r => {r.output.profile = e.target.value as 'qwen21' | 'turbo'; if (r.output.profile === 'turbo') r.output.refine = false;})}>
                <option value="qwen21">Qualidade máxima</option><option value="turbo">Turbo</option></select></label>
            <button className={'pill toggle' + (request.output.verify ? ' on' : '')} aria-pressed={request.output.verify}
                    onClick={() => patch(r => {r.output.verify = !r.output.verify;})} title="Conferir cada imagem com o modelo local">
              <Icon name="check" size={13} />Verificar</button>
          </div>
          <div className="composer-actions">
            {busy && <button className="btn-stop" disabled={run?.cancel_requested} onClick={props.onStop} aria-label="Parar" title="Parar (Esc)">
              <Icon name="stop" size={13} />{run?.cancel_requested ? 'Parando…' : 'Parar'}</button>}
            <button className="btn-generate" disabled={submitting || busy || !prepared?.valid} onClick={props.onSubmit} title="Gerar (Ctrl+Enter)">
              <span>{submitting ? 'Enviando…' : edit ? 'Gerar edição' : 'Gerar imagem'}</span><kbd aria-hidden="true">Ctrl ↵</kbd>
            </button>
          </div>
        </footer>
      </section>
      {masking && target && (
        <MaskEditor src={fileUrl(target.hash)} width={target.width} height={target.height} onSave={saveMask} onCancel={() => setMasking(false)} />
      )}
    </div>
  );
}
