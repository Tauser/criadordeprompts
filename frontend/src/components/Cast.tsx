import {useEffect, useState} from 'react';
import {api, fileUrl} from '../api/client';
import type {CharacterPosition, SavedCharacter, Sex} from '../api/types';
import {imageSize} from '../lib/characters';
import {uuid} from '../lib/uuid';
import {MAX_CHARACTERS, addSavedCharacter, addSavedPrincipal, describeCharacter, placeCharacter, removeCharacter, sexesWith,
  type Workspace} from '../state/workspace';
import {Segmented} from './Controls';
import {TranslateButton} from './Translate';

interface Props {
  workspace: Workspace;
  names: string[];                 // everyone in the result, the first person first
  automatic: boolean;              // the count comes from the choices, not from a number the person typed
  disabled?: boolean;
  issues?: Record<string, string[]>;
  update: (next: Workspace | ((ws: Workspace) => Workspace)) => void;
  notify: (message: string, error?: boolean) => void;
}

const issueList = (messages?: string[]) =>
  messages?.length ? <ul className="field-issues">{messages.map(m => <li key={m}>{m}</li>)}</ul> : null;

const POSITIONS: [CharacterPosition | '', string][] = [['', 'Ao lado'], ['left', 'À esquerda'], ['right', 'À direita'],
  ['behind', 'Atrás'], ['front', 'Na frente']];

// Everyone the picture will show, at the top of the request: who they are, a woman or a man, where each character
// stands and what they do, and the fichas to bring more people in.
export function Cast({workspace, names, automatic, disabled, issues = {}, update, notify}: Props) {
  const request = workspace.request;
  const edit = request.mode === 'edit';
  const characters = request.characters ?? [];
  const sexes = request.participants.sexes ?? [];
  const full = characters.length >= MAX_CHARACTERS;
  const [busy, setBusy] = useState(false);
  // Fichas de personagem saved on the "Personagens" screen; this form only reads them.
  const [saved, setSaved] = useState<SavedCharacter[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let stopped = false;
    api.characters()
      .then(result => {if (!stopped) setSaved(result.characters);})
      .catch(() => {if (!stopped) setFailed(true);});
    return () => {stopped = true;};
  }, []);

  // The ficha's main photo becomes a reference: the first person's identity, or another person in the scene.
  const useSaved = async (id: string, principal = false) => {
    const character = saved?.find(c => c.id === id);
    if (!character || !character.photos[0]) return;
    if (full && !principal) {notify(`Use até ${MAX_CHARACTERS} personagens extras.`, true); return;}
    if (request.references.length >= 10) {notify('Use até dez imagens.', true); return;}
    setBusy(true);
    try {
      const hash = character.photos[0];
      const size = await imageSize(fileUrl(hash));
      const file = {hash, width: size.width, height: size.height, name: character.name};
      const refId = 'ref-' + uuid().slice(0, 8);
      update(ws => principal ? addSavedPrincipal(ws, refId, file, character.sex ?? null)
        : addSavedCharacter(ws, refId, file, character.notes, character.sex ?? null));
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  const placeholder = saved === null ? (failed ? 'Indisponível' : 'Carregando…') : saved.length ? 'Escolha uma ficha' : 'Nenhuma ficha salva';
  const picker = (label: string, principal: boolean) => (
    <label>{label}
      <select aria-label={label} value="" disabled={disabled || busy || (!principal && full) || !saved?.length}
              onChange={e => {if (e.target.value) void useSaved(e.target.value, principal);}}>
        <option value="">{placeholder}</option>
        {saved?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </label>
  );
  const people = names.length ? names : ['Pessoa 1'];

  return (
    <section className="card cast-card" aria-labelledby="cast-title">
      <div className="section-title">
        <h2 id="cast-title">Elenco</h2>
        <span className="muted small" title={automatic ? 'O número vem das fotos, fichas e opções escolhidas. Para fixar outro, use Avançado → Cena.'
          : 'Número fixado em Avançado → Cena.'}>
          {people.length} {people.length === 1 ? 'pessoa' : 'pessoas'}{automatic ? ' · automático' : ''}</span>
      </div>
      <ul className="cast-list">
        {people.map((name, i) => {
          const character = i > 0 ? characters[i - 1] : undefined;
          const index = character ? characters.indexOf(character) : -1;
          return (
            <li key={i} className="cast-person">
              <div className="cast-row">
                <span className="cast-name" title={name}>{name}</span>
                {people.length > 1 && (
                  <Segmented<Sex | ''> small label={`Sexo de ${name}`} value={sexes[i] ?? ''} disabled={disabled}
                    options={[{value: 'female', label: 'Mulher'}, {value: 'male', label: 'Homem'}]}
                    onChange={value => update(ws => {
                      const next = structuredClone(ws);
                      next.request.participants.sexes = sexesWith(next.request.participants.sexes, i + 1,
                        value === sexes[i] ? null : value || null);
                      return next;
                    })} />
                )}
              </div>
              {character && (
                <div className="cast-character">
                  <select aria-label={`Posição do personagem ${i + 1}`} value={character.position ?? ''} disabled={disabled}
                          title="Onde a pessoa fica na imagem, olhando a foto de frente."
                          onChange={e => update(ws => placeCharacter(ws, character.reference_id,
                            (e.target.value || null) as CharacterPosition | null))}>
                    {POSITIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                  <input aria-label={`Personagem ${i + 1} · onde está e o que faz (opcional, em inglês)`}
                         title="Opcional, em inglês: onde a pessoa está e o que faz."
                         value={character.description} maxLength={500} disabled={disabled}
                         placeholder="Onde está e o que faz (opcional, em inglês)"
                         onChange={e => update(ws => describeCharacter(ws, character.reference_id, e.target.value))} />
                  <TranslateButton label={`a descrição do personagem ${i + 1}`} text={character.description} disabled={disabled}
                                   onTranslated={text => update(ws => describeCharacter(ws, character.reference_id, text))} />
                  <button type="button" className="quiet small" disabled={disabled}
                          onClick={() => update(ws => removeCharacter(ws, character.reference_id))}>Tirar do elenco</button>
                  {issueList(issues[`characters.${index}.position`])}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {issueList(issues['participants.sexes'])}
      <div className="character-pick">
        {!edit && picker('Personagem principal da ficha', true)}
        {picker(edit ? 'Usar personagem da ficha' : 'Outro personagem da ficha', false)}
        {full && <ul className="field-issues"><li>Já há {MAX_CHARACTERS} personagens extras na cena. Tire um para usar outra ficha.</li></ul>}
        {issueList(issues['characters'])}
      </div>
    </section>
  );
}
