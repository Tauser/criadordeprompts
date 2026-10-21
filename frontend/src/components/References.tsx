import {useEffect, useRef, useState} from 'react';
import {api, fileUrl} from '../api/client';
import {CATEGORY_LABELS} from '../lib/labels';
import {sortBy} from '../lib/sort';
import {uuid} from '../lib/uuid';
import {MAX_CHARACTERS, ROLES, addCharacter, addReference, applyReference, characterNumber, describeCharacter, referenceRoles,
  removeCharacter, removeReference, setTarget, swapReferenceIds, type Workspace} from '../state/workspace';
import {Switch, Tip} from './Controls';
import {Icon} from './Icon';
import {MaskEditor} from './MaskEditor';
import {TranslateButton} from './Translate';

interface Props {
  workspace: Workspace;
  slots: Record<string, number>;
  disabled: boolean;
  update: (next: Workspace | ((ws: Workspace) => Workspace)) => void;
  notify: (message: string, error?: boolean) => void;
}

export function References({workspace, slots, disabled, update, notify}: Props) {
  const [busy, setBusy] = useState(false);
  const [masking, setMasking] = useState(false);
  const request = workspace.request;
  const edit = request.mode === 'edit';
  const target = request.target_id ? workspace.files[request.target_id] : null;

  const [menu, setMenu] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const addRef = useRef<(files: File[]) => void>(() => undefined);

  const add = async (list: FileList | File[] | null) => {
    const all = Array.from(list ?? []);
    const files = all.filter(f => /^image\/(png|jpeg|webp)$/.test(f.type));
    if (!files.length) {if (all.length) notify('Use imagens PNG, JPEG ou WebP.', true); return;}
    if (files.length > 10 - request.references.length) {notify('Use até dez imagens.', true); return;}
    setBusy(true);
    try {
      for (const file of files) {
        const stored = await api.upload(file, file.name);
        const id = 'ref-' + uuid().slice(0, 8);
        update(ws => addReference(ws, id, {hash: stored.hash, width: stored.width, height: stored.height, name: file.name}));
      }
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  addRef.current = files => {if (!disabled && !busy) add(files);};
  // Ctrl+V with an image on the clipboard adds it; pasting text into a field is left alone.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? []).filter(f => f.type.startsWith('image/'));
      if (!files.length) return;
      event.preventDefault();
      addRef.current(files);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, []);
  useEffect(() => {
    if (!menu) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !(event.target as Element).closest?.('.ref-menu-wrap')) setMenu(null);
    };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', close);
    return () => {document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', close);};
  }, [menu]);

  const act = (fn: (ws: Workspace) => Workspace) => {
    setMenu(null);
    try {update(fn);} catch (error) {notify((error as Error).message, true);}
  };
  const saveMask = async (blob: Blob) => {
    try {
      const stored = await api.upload(blob, 'mascara.png');
      update(ws => ({...ws, maskHash: stored.hash, request: {...ws.request, mask: true}}));
      setMasking(false);
    } catch (error) {notify((error as Error).message, true);}
  };

  const swapped = swapReferenceIds(workspace);           // crops used only by "Trocar pessoas", shown there
  const shown = request.references.filter(ref => !swapped.has(ref.id));
  const empty = shown.length === 0;
  const characters = request.references.flatMap(ref => {
    const person = characterNumber(workspace, ref.id);
    const character = (request.characters ?? []).find(c => c.reference_id === ref.id);
    return person && character ? [{ref, person, character}] : [];
  });
  const upload = (
    <input type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={disabled || busy} aria-label="Adicionar imagens"
           onChange={e => {add(e.target.files); e.target.value = '';}} />
  );

  return (
    <section className={'card references' + (dragging ? ' dragging' : '')} aria-labelledby="refs-title"
             onDragOver={e => {if (e.dataTransfer.types.includes('Files')) {e.preventDefault(); setDragging(true);}}}
             onDragLeave={e => {if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);}}
             onDrop={e => {e.preventDefault(); setDragging(false); addRef.current(Array.from(e.dataTransfer.files));}}>
      <div className="section-title">
        <h2 id="refs-title" tabIndex={-1}>{edit ? 'Foto e referências' : <>Referências <span className="muted light">· opcional</span></>}</h2>
        <span className="spacer" />
        <span className="muted small num">{request.references.length} / 10</span>
        {!empty && <label className={'button secondary small' + (disabled || busy ? ' disabled' : '')}>
          <Icon name="plus" size={14} />{busy ? 'Enviando…' : 'Adicionar'}{upload}</label>}
      </div>
      {empty && (
        <label className={'upload' + (disabled || busy ? ' disabled' : '')}>
          <Icon name="upload" size={20} />
          <strong>{busy ? 'Enviando…' : edit ? 'Arraste a foto que será editada' : 'Arraste imagens para trazer rosto, roupa, pose ou estilo'}</strong>
          <span className="muted small">ou clique para escolher · Ctrl+V cola da área de transferência</span>
          {upload}
        </label>
      )}
      {!empty && <ul className="reference-grid">
        {shown.map(ref => {
          const file = workspace.files[ref.id];
          const isTarget = ref.id === request.target_id;
          const roles = referenceRoles(workspace, ref.id);
          const person = characterNumber(workspace, ref.id);
          const castFull = (request.characters ?? []).length >= MAX_CHARACTERS;
          const slot = isTarget ? 1 : slots[ref.id];
          const role = isTarget ? 'Foto alvo' : person ? `Personagem ${person}` : roles.length ? 'Referência' : 'Não usada';
          const actions = [
            edit && !isTarget ? {label: 'Usar como foto alvo', run: () => {
              if (confirm('Usar esta imagem como foto alvo? Ela deixará de fornecer atributos.')) act(ws => setTarget(ws, ref.id)); else setMenu(null);}} : null,
            person ? {label: 'Não usar como personagem', run: () => act(ws => removeCharacter(ws, ref.id))} : null,
            {label: 'Remover', danger: true, run: () => {
              if (!roles.length && !isTarget && !person || confirm('Remover esta imagem? As escolhas anteriores dos campos serão restauradas.'))
                act(ws => removeReference(ws, ref.id));
              else setMenu(null);
            }},
          ].filter(a => a !== null) as {label: string; danger?: boolean; run: () => void}[];
          return (
            <li key={ref.id} className={'reference' + (isTarget ? ' target' : '') + (person ? ' cast' : '') + (!isTarget && !person && !roles.length ? ' unused' : '')}>
              <div className="reference-thumb">
                {file ? <img src={fileUrl(file.hash)} alt={ref.label} /> : <span className="missing">Sem arquivo</span>}
                <span className="role-chip" title={slot ? `Enviada ao modelo como image${slot}` : 'Não é enviada ao modelo'}>{role}</span>
                <span className="ref-menu-wrap">
                  <button type="button" className="ref-menu-btn" aria-label={`Ações de ${ref.label}`} aria-haspopup="menu"
                          aria-expanded={menu === ref.id} disabled={disabled} onClick={() => setMenu(m => m === ref.id ? null : ref.id)}>
                    <Icon name="more" size={16} /></button>
                  {menu === ref.id && <span className="ref-menu" role="menu">
                    {actions.map(a => <button key={a.label} type="button" role="menuitem" className={a.danger ? 'danger' : ''} onClick={a.run}>{a.label}</button>)}
                  </span>}
                </span>
              </div>
              <div className="reference-body">
                <strong title={ref.label}>{ref.label}</strong>
                {isTarget ? <span className="muted small">Será editada</span>
                  : person ? <span className="muted small">Rosto, corpo, pele e cabelo</span>
                  : roles.length ? <span className="muted small">Fornece: {roles.map(r => CATEGORY_LABELS[r]).join(', ')}</span> : null}
                {!isTarget && (
                  <select aria-label={`Aplicar ${ref.label} como`} value="" disabled={disabled}
                          onChange={e => {
                            const value = e.target.value;
                            if (!value) return;
                            act(ws => value === '@character' ? addCharacter(ws, ref.id) : applyReference(ws, ref.id, value));
                          }}>
                    <option value="">{person ? 'Usar de outro jeito…' : roles.length ? 'Aplicar também como…' : 'Aplicar como…'}</option>
                    {!person && <option value="@character" disabled={castFull}>
                      {castFull ? `Outro personagem na cena (máximo ${MAX_CHARACTERS})` : 'Outro personagem na cena'}</option>}
                    <optgroup label="Para a pessoa principal ou a cena">
                      {sortBy(Object.entries(ROLES), ([, r]) => r.label).map(([key, r]) => <option key={key} value={key}>{r.label}</option>)}
                    </optgroup>
                  </select>
                )}
              </div>
            </li>
          );
        })}
      </ul>}
      {characters.map(({ref, person, character}) => (
        <div key={ref.id} className="character-note">
          <label htmlFor={`character-${ref.id}`}>Personagem {person} · onde está e o que faz <span className="muted">(opcional, em inglês)</span></label>
          <input id={`character-${ref.id}`} value={character.description} maxLength={500} disabled={disabled}
                 placeholder="Ex.: standing to her left, holding her hand"
                 onChange={e => update(ws => describeCharacter(ws, ref.id, e.target.value))} />
          <TranslateButton label={`a descrição do personagem ${person}`} text={character.description} disabled={disabled}
                           onTranslated={text => update(ws => describeCharacter(ws, ref.id, text))} />
        </div>
      ))}
      {edit && target && (
        <div className="mask-row">
          <Switch checked={request.mask} disabled={disabled}
                  onChange={on => on ? setMasking(true) : update(ws => ({...ws, maskHash: null, request: {...ws.request, mask: false}}))}>
            <strong>Editar só uma área</strong></Switch>
          <Tip>Pinte a área que pode mudar; fora dela a foto fica idêntica. Com máscara, a edição usa o tamanho original da foto.</Tip>
          {request.mask && workspace.maskHash && <>
            <img className="mask-thumb" src={fileUrl(workspace.maskHash)} alt="Máscara atual" />
            <button className="quiet" disabled={disabled} onClick={() => setMasking(true)}>Redesenhar</button>
          </>}
        </div>
      )}
      {masking && target && request.target_id && (
        <MaskEditor src={fileUrl(target.hash)} width={target.width} height={target.height}
                    onSave={saveMask} onCancel={() => setMasking(false)} />
      )}
    </section>
  );
}
