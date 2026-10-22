import {useEffect, useState} from 'react';
import {api, fileUrl} from '../api/client';
import type {SavedCharacter} from '../api/types';
import {CHARACTER_NAME_MAX, CHARACTER_NOTES_MAX, CHARACTER_PHOTOS_MAX, faceWordsIn} from '../lib/characters';
import {sortBy} from '../lib/sort';
import {Icon} from './Icon';

interface Props {notify: (message: string, error?: boolean) => void}
type Editing = SavedCharacter | 'new' | null;

// "Personagens": fichas de pessoas salvas para reusar em outros pedidos. The request form picks them from here.
export function Characters({notify}: Props) {
  const [list, setList] = useState<SavedCharacter[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);

  useEffect(() => {
    let stopped = false;
    api.characters()
      .then(result => {if (!stopped) setList(sortBy(result.characters, c => c.name));})
      .catch(() => {if (!stopped) setFailed(true);});
    return () => {stopped = true;};
  }, []);

  const saved = (character: SavedCharacter) => {
    setList(current => sortBy([...(current ?? []).filter(c => c.id !== character.id), character], c => c.name));
    setEditing(null);
  };
  const removed = (id: string) => {
    setList(current => (current ?? []).filter(c => c.id !== id));
    setEditing(null);
  };

  if (editing) return (
    <div className="characters-page">
      <CharacterEditor key={editing === 'new' ? 'new' : editing.id} character={editing === 'new' ? null : editing}
                       notify={notify} onSaved={saved} onDeleted={removed} onClose={() => setEditing(null)} />
    </div>
  );

  return (
    <div className="characters-page">
      <div className="page-head">
        <div>
          <h1>Personagens</h1>
          <p className="muted">Pessoas salvas para usar em outros pedidos. O rosto vem da foto principal.</p>
        </div>
        <button className="secondary" onClick={() => setEditing('new')}><Icon name="plus" size={14} />Nova ficha</button>
      </div>
      {failed && <p className="help">Não foi possível carregar as fichas. Atualize a página para tentar de novo.</p>}
      {!failed && list === null && <p className="muted">Carregando…</p>}
      {list?.length === 0 && (
        <div className="stage-empty">Nenhuma ficha ainda. Crie uma para trazer a mesma pessoa para outros pedidos.</div>
      )}
      {!!list?.length && (
        <ul className="character-grid">
          {list.map(character => (
            <li key={character.id}>
              <button type="button" className="character-card" onClick={() => setEditing(character)}>
                <span className="character-photo">
                  {character.photos[0] ? <img src={fileUrl(character.photos[0])} alt="" /> : <span className="missing">Sem foto</span>}
                </span>
                <strong>{character.name}</strong>
                {character.notes && <span className="muted small character-notes">{character.notes}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface EditorProps {
  character: SavedCharacter | null;
  notify: (message: string, error?: boolean) => void;
  onSaved: (character: SavedCharacter) => void;
  onDeleted: (id: string) => void;
  onClose: () => void;
}
type Errors = Partial<Record<'name' | 'photos', string>>;

function CharacterEditor({character, notify, onSaved, onDeleted, onClose}: EditorProps) {
  const [name, setName] = useState(character?.name ?? '');
  const [notes, setNotes] = useState(character?.notes ?? '');
  const [photos, setPhotos] = useState<string[]>(character?.photos ?? []);
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const faceWords = faceWordsIn(notes);
  const full = photos.length >= CHARACTER_PHOTOS_MAX;

  const addPhotos = async (list: FileList | null) => {
    const files = Array.from(list ?? []).filter(f => /^image\/(png|jpeg|webp)$/.test(f.type));
    if (!files.length) {if (list?.length) notify('Use imagens PNG, JPEG ou WebP.', true); return;}
    const room = CHARACTER_PHOTOS_MAX - photos.length;
    if (files.length > room) setErrors(e => ({...e, photos: `Use até ${CHARACTER_PHOTOS_MAX} fotos por ficha.`}));
    setBusy(true);
    try {
      for (const file of files.slice(0, room)) {
        const stored = await api.upload(file, file.name);
        setPhotos(current => [...current, stored.hash]);
      }
      setErrors(e => ({...e, photos: undefined}));
    } catch (failure) {
      notify((failure as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  const makeMain = (index: number) => setPhotos(current => [current[index], ...current.filter((_, i) => i !== index)]);
  const removePhoto = (index: number) => setPhotos(current => current.filter((_, i) => i !== index));

  const save = async () => {
    const trimmed = name.trim();
    const next: Errors = {};
    if (!trimmed) next.name = 'Dê um nome ao personagem.';
    if (!photos.length) next.photos = 'Adicione pelo menos uma foto.';
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    setError(null);
    try {
      const body = {name: trimmed, notes: notes.trim(), photos};
      const result = character ? await api.updateCharacter(character.id, body) : await api.createCharacter(body);
      notify(`Ficha “${result.name}” salva.`);
      onSaved(result);
    } catch (failure) {
      setError((failure as Error).message);
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!character || !confirm(`Apagar a ficha de “${character.name}”? Esta ação não pode ser desfeita.`)) return;
    setBusy(true);
    try {
      await api.deleteCharacter(character.id);
      notify('Ficha apagada.');
      onDeleted(character.id);
    } catch (failure) {
      setError((failure as Error).message);
      setBusy(false);
    }
  };

  return (
    <section className="card character-editor" aria-labelledby="character-title">
      <div className="section-title">
        <h2 id="character-title" tabIndex={-1}>{character ? 'Editar ficha' : 'Nova ficha'}</h2>
        <span className="spacer" />
        <button type="button" className="quiet" disabled={busy} onClick={onClose}>Voltar</button>
      </div>
      <div className="character-fields">
        <label>Nome
          <input value={name} maxLength={CHARACTER_NAME_MAX} disabled={busy} placeholder="Ex.: Ana"
                 onChange={e => {setName(e.target.value); setErrors(x => ({...x, name: undefined}));}} />
        </label>
        {errors.name && <ul className="field-issues"><li>{errors.name}</li></ul>}

        <label>Notas
          <textarea rows={4} value={notes} maxLength={CHARACTER_NOTES_MAX} disabled={busy}
                    placeholder="Roupa de sempre, jeito de ser. Não descreva o rosto: ele vem da foto."
                    onChange={e => setNotes(e.target.value)} />
        </label>
        <span className="muted small num">{notes.length} / {CHARACTER_NOTES_MAX}</span>
        {faceWords.length > 0 && (
          <div className="issue warning" role="status">
            <span className="level">Atenção</span>
            As notas descrevem o rosto ou o cabelo ({faceWords.join(', ')}). Com uma foto, isso faz o modelo ignorar a foto.
            Deixe nas notas só roupa e jeito de ser.
          </div>
        )}

        <div className="character-photos-head" title="A primeira foto é a principal: ela aparece na lista e é a usada nos pedidos.">
          <strong>Fotos</strong>
          <span className="muted small num">{photos.length} / {CHARACTER_PHOTOS_MAX}</span>
          <span className="spacer" />
          <label className={'button secondary small' + (busy || full ? ' disabled' : '')}>
            <Icon name="upload" size={14} />{busy ? 'Enviando…' : 'Adicionar fotos'}
            <input type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={busy || full} aria-label="Adicionar fotos"
                   onChange={e => {void addPhotos(e.target.files); e.target.value = '';}} />
          </label>
        </div>
        {photos.length > 0 && (
          <ul className="character-photo-grid">
            {photos.map((hash, index) => (
              <li key={hash + index} className={'character-photo-item' + (index === 0 ? ' main' : '')}>
                <img src={fileUrl(hash)} alt={index === 0 ? 'Foto principal' : `Foto ${index + 1}`} />
                {index === 0 && <span className="role-chip">Principal</span>}
                <span className="character-photo-actions">
                  {index > 0 && <button type="button" className="quiet" disabled={busy} onClick={() => makeMain(index)}>Tornar principal</button>}
                  <button type="button" className="quiet stop" disabled={busy} onClick={() => removePhoto(index)}>Remover</button>
                </span>
              </li>
            ))}
          </ul>
        )}
        {errors.photos && <ul className="field-issues"><li>{errors.photos}</li></ul>}
      </div>

      {error && <ul className="field-issues"><li>{error}</li></ul>}
      <div className="saved-actions">
        <button type="button" className="quiet" disabled={busy} onClick={save}>{character ? 'Salvar' : 'Criar ficha'}</button>
        {character && <button type="button" className="quiet stop" disabled={busy} onClick={remove}>Apagar</button>}
      </div>
    </section>
  );
}
