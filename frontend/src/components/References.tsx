import {useState} from 'react';
import {api, fileUrl} from '../api/client';
import {CATEGORY_LABELS} from '../lib/labels';
import {ROLES, addReference, applyReference, referenceRoles, removeReference, setTarget, type Workspace} from '../state/workspace';
import {MaskEditor} from './MaskEditor';

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

  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        const stored = await api.upload(file, file.name);
        const id = 'ref-' + crypto.randomUUID().slice(0, 8);
        update(ws => addReference(ws, id, {hash: stored.hash, width: stored.width, height: stored.height, name: file.name}));
      }
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  const act = (fn: (ws: Workspace) => Workspace) => {
    try {update(fn);} catch (error) {notify((error as Error).message, true);}
  };
  const saveMask = async (blob: Blob) => {
    try {
      const stored = await api.upload(blob, 'mascara.png');
      update(ws => ({...ws, maskHash: stored.hash, request: {...ws.request, mask: true}}));
      setMasking(false);
    } catch (error) {notify((error as Error).message, true);}
  };

  return (
    <section className="card" aria-labelledby="refs-title">
      <div className="section-title">
        <h2 id="refs-title">{edit ? 'Foto e referências' : 'Referências (opcional)'}</h2>
        <span className="muted">{request.references.length} / 10</span>
      </div>
      <p className="help">{edit ? 'A foto alvo é a imagem que será editada. As outras imagens só fornecem o que você aplicar a partir delas.'
        : 'Use imagens para trazer rosto, roupa, pose ou estilo para a cena nova.'}</p>
      <label className={'upload' + (disabled || busy ? ' disabled' : '')}>
        {busy ? 'Enviando…' : '＋ Adicionar imagens'}
        <input type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={disabled || busy}
               onChange={e => {add(e.target.files); e.target.value = '';}} />
      </label>
      <ul className="reference-list">
        {request.references.map(ref => {
          const file = workspace.files[ref.id];
          const isTarget = ref.id === request.target_id;
          const roles = referenceRoles(workspace, ref.id);
          return (
            <li key={ref.id} className={'reference' + (isTarget ? ' target' : '')}>
              {file ? <img src={fileUrl(file.hash)} alt={ref.label} /> : <span className="missing">Sem arquivo</span>}
              <div className="reference-body">
                <strong>{ref.label}</strong>
                <span className="badge">{isTarget ? 'Foto alvo · image1' : slots[ref.id] ? `image${slots[ref.id]}` : 'Não usada'}</span>
                {!isTarget && <span className="muted">{roles.length ? 'Fornece: ' + roles.map(r => CATEGORY_LABELS[r]).join(', ') : 'Escolha o que aplicar.'}</span>}
                <div className="row">
                  {!isTarget && (
                    <select aria-label={`Aplicar ${ref.label} como`} value="" disabled={disabled}
                            onChange={e => e.target.value && act(ws => applyReference(ws, ref.id, e.target.value))}>
                      <option value="">Aplicar como…</option>
                      {Object.entries(ROLES).map(([key, role]) => <option key={key} value={key}>{role.label}</option>)}
                    </select>
                  )}
                  {edit && !isTarget && <button className="quiet" disabled={disabled}
                    onClick={() => confirm('Usar esta imagem como foto alvo? Ela deixará de fornecer atributos.') && act(ws => setTarget(ws, ref.id))}>Usar como alvo</button>}
                  <button className="quiet" disabled={disabled}
                    onClick={() => (!roles.length && !isTarget || confirm('Remover esta imagem? As escolhas anteriores dos campos serão restauradas.')) && act(ws => removeReference(ws, ref.id))}>Remover</button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {edit && target && (
        <div className="mask-row">
          <label className="check">
            <input type="checkbox" checked={request.mask} disabled={disabled}
                   onChange={e => e.target.checked ? setMasking(true) : update(ws => ({...ws, maskHash: null, request: {...ws.request, mask: false}}))} />
            Editar só uma área (máscara)
          </label>
          {request.mask && workspace.maskHash && <>
            <img className="mask-thumb" src={fileUrl(workspace.maskHash)} alt="Máscara atual" />
            <button className="quiet" disabled={disabled} onClick={() => setMasking(true)}>Redesenhar</button>
          </>}
          {request.mask && <p className="help">Com máscara, a edição usa o tamanho original da foto.</p>}
        </div>
      )}
      {masking && target && request.target_id && (
        <MaskEditor src={fileUrl(target.hash)} width={target.width} height={target.height}
                    onSave={saveMask} onCancel={() => setMasking(false)} />
      )}
    </section>
  );
}
