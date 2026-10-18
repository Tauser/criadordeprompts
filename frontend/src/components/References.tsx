import {useState} from 'react';
import {api, fileUrl} from '../api/client';
import {CATEGORY_LABELS} from '../lib/labels';
import {sortBy} from '../lib/sort';
import {uuid} from '../lib/uuid';
import {MAX_CHARACTERS, ROLES, addCharacter, addReference, applyReference, characterNumber, describeCharacter, referenceRoles,
  removeCharacter, removeReference, setTarget, type Workspace} from '../state/workspace';
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

  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    if (files.length > 10 - request.references.length) {notify('Use até dez imagens.', true); return;}
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
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
        : 'Use imagens para trazer rosto, roupa, pose ou estilo para a cena nova, ou para incluir outro personagem.'}</p>
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
          const person = characterNumber(workspace, ref.id);
          const character = (request.characters ?? []).find(c => c.reference_id === ref.id);
          const castFull = (request.characters ?? []).length >= MAX_CHARACTERS;
          return (
            <li key={ref.id} className={'reference' + (isTarget ? ' target' : '') + (person ? ' cast' : '')}>
              {file ? <img src={fileUrl(file.hash)} alt={ref.label} /> : <span className="missing">Sem arquivo</span>}
              <div className="reference-body">
                <strong>{ref.label}</strong>
                <span className="badge">{isTarget ? 'Foto alvo · image1' : person ? `Personagem ${person} · image${slots[ref.id] ?? '?'}`
                  : slots[ref.id] ? `image${slots[ref.id]}` : 'Não usada'}</span>
                {!isTarget && !person && <span className="muted">{roles.length ? 'Fornece: ' + roles.map(r => CATEGORY_LABELS[r]).join(', ') : 'Escolha o que aplicar.'}</span>}
                {person && character && <>
                  <span className="muted">Outra pessoa na cena, com a aparência desta foto (rosto, corpo, pele e cabelo).</span>
                  <input className="character-note" value={character.description} maxLength={500} disabled={disabled}
                         placeholder="Opcional, em inglês: where this person is and what they do"
                         aria-label={`Descrição do personagem ${person} em inglês`}
                         onChange={e => update(ws => describeCharacter(ws, ref.id, e.target.value))} />
                  <TranslateButton label={`a descrição do personagem ${person}`} text={character.description} disabled={disabled}
                                   onTranslated={text => update(ws => describeCharacter(ws, ref.id, text))} />
                </>}
                <div className="row">
                  {!isTarget && (
                    <select aria-label={`Aplicar ${ref.label} como`} value="" disabled={disabled}
                            onChange={e => {
                              const value = e.target.value;
                              if (!value) return;
                              act(ws => value === '@character' ? addCharacter(ws, ref.id) : applyReference(ws, ref.id, value));
                            }}>
                      <option value="">{person ? 'Usar de outro jeito…' : 'Aplicar como…'}</option>
                      {!person && <option value="@character" disabled={castFull}>
                        {castFull ? `Outro personagem na cena (máximo ${MAX_CHARACTERS})` : 'Outro personagem na cena'}</option>}
                      <optgroup label="Para a pessoa principal ou a cena">
                        {sortBy(Object.entries(ROLES), ([, role]) => role.label).map(([key, role]) => <option key={key} value={key}>{role.label}</option>)}
                      </optgroup>
                    </select>
                  )}
                  {person && <button className="quiet" disabled={disabled} onClick={() => act(ws => removeCharacter(ws, ref.id))}>Não usar como personagem</button>}
                  {edit && !isTarget && <button className="quiet" disabled={disabled}
                    onClick={() => confirm('Usar esta imagem como foto alvo? Ela deixará de fornecer atributos.') && act(ws => setTarget(ws, ref.id))}>Usar como alvo</button>}
                  <button className="quiet" disabled={disabled}
                    onClick={() => (!roles.length && !isTarget && !person || confirm('Remover esta imagem? As escolhas anteriores dos campos serão restauradas.')) && act(ws => removeReference(ws, ref.id))}>Remover</button>
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
