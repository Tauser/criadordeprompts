import {useEffect, useRef, useState} from 'react';
import {ApiError, api, fileUrl} from '../api/client';
import type {CharacterPosition, Issue, Run, SavedCharacter, SavedRequest} from '../api/types';
import {RUN_STATUS, TERMINAL} from '../lib/labels';
import {uuid} from '../lib/uuid';
import {buildSceneRequest, EDIT_PRESET_WARNING, EXTRA_PEOPLE_MAX, loadStory, newScene, POSITIONS, saveStory, type Scene,
  type SceneInput, type ScenePerson, type Story} from '../lib/scenes';
import {Icon} from './Icon';

interface Props {
  notify: (message: string, error?: boolean) => void;
  onOpenRun: (id: string) => void;     // opens the run in the Studio view, as the History does
}

// What became of one scene in the last "Gerar todas".
type RowStatus = 'working' | 'sent' | 'skipped' | 'error';
interface SceneRow {key: string; number: number; label: string; status: RowStatus; runId?: string; message?: string; issues?: string[]}

// "Cenas do conto": a story of scenes. Each scene is a saved request with its people (fichas); "Gerar todas" sends one
// generation per scene, in order, and follows each run until it ends.
export function Scenes({notify, onOpenRun}: Props) {
  const [story, setStory] = useState<Story>(loadStory);
  const [presets, setPresets] = useState<SavedRequest[] | null>(null);
  const [presetsFailed, setPresetsFailed] = useState(false);
  const [fichas, setFichas] = useState<SavedCharacter[] | null>(null);
  const [fichasFailed, setFichasFailed] = useState(false);
  const [rows, setRows] = useState<SceneRow[] | null>(null);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);

  useEffect(() => {
    let stopped = false;
    api.presets()
      .then(result => {if (!stopped) setPresets(result.presets);})
      .catch(() => {if (!stopped) setPresetsFailed(true);});
    api.characters()
      .then(result => {if (!stopped) setFichas(result.characters);})
      .catch(() => {if (!stopped) setFichasFailed(true);});
    return () => {stopped = true;};
  }, []);

  useEffect(() => {
    saveStory(story);
  }, [story]);

  const presetById = (id: string) => presets?.find(p => p.id === id) ?? null;
  const fichaById = (id: string | null) => fichas?.find(c => c.id === id) ?? null;
  const sendable = story.scenes.filter(scene => presetById(scene.preset)?.request.mode === 'generate');

  const edit = (change: (scenes: Scene[]) => Scene[]) => setStory(current => ({...current, scenes: change(current.scenes)}));
  const patch = (id: string, change: Partial<Scene>) => edit(list => list.map(s => s.id === id ? {...s, ...change} : s));
  const move = (index: number, delta: number) => edit(list => {
    const target = index + delta;
    if (target < 0 || target >= list.length) return list;
    const next = [...list];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });
  const duplicate = (index: number) => edit(list => {
    const copy: Scene = {...list[index], id: uuid(), people: list[index].people.map(p => ({...p}))};
    return [...list.slice(0, index + 1), copy, ...list.slice(index + 1)];
  });

  // The request of one scene from the saved choices; a ficha that was deleted is reported as the scene's error.
  const inputFor = (scene: Scene, preset: SavedRequest): SceneInput => {
    const main = scene.main ? fichaById(scene.main) : null;
    if (scene.main && !main) throw new Error('A ficha da pessoa principal não foi encontrada.');
    const people = scene.people.map((person: ScenePerson) => {
      if (!person.character) throw new Error('Escolha a ficha de cada outra pessoa da cena.');
      const character = fichaById(person.character);
      if (!character) throw new Error('Uma ficha desta cena não foi encontrada.');
      return {character, position: person.position};
    });
    return {preset, main, people, note: scene.note};
  };

  // One scene: the same check the form makes (prepare) before the run is created. Its failure stays on its row.
  const sendScene = async (scene: Scene, preset: SavedRequest): Promise<Partial<SceneRow>> => {
    try {
      const built = await buildSceneRequest(inputFor(scene, preset));
      const prepared = await api.prepare(built.request);
      if (!prepared.valid) {
        return {status: 'error', message: 'A cena não passou na verificação do pedido.',
          issues: prepared.issues.filter(issue => issue.level === 'error').map(issue => issue.message)};
      }
      const created = await api.createRun({request_id: uuid(), request: built.request, files: built.files, mask: null});
      return {status: 'sent', runId: created.id};
    } catch (error) {
      const issues = error instanceof ApiError && error.status === 422 ? (error.body.issues ?? []) as Issue[] : [];
      return {status: 'error', message: (error as Error).message, issues: issues.map(issue => issue.message)};
    }
  };

  const generateAll = async () => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    const initial: SceneRow[] = story.scenes.map((scene, index): SceneRow => {
      const preset = presetById(scene.preset);
      const base = {key: scene.id, number: index + 1, label: preset?.name ?? 'Sem pedido'};
      if (!preset) return {...base, status: 'error', message: 'Escolha um pedido salvo.'};
      if (preset.request.mode === 'edit') return {...base, status: 'skipped', message: EDIT_PRESET_WARNING};
      return {...base, status: 'working'};
    });
    setRows(initial);
    let tried = 0, sent = 0;
    for (const scene of story.scenes) {
      if (!initial.some(row => row.key === scene.id && row.status === 'working')) continue;
      tried++;
      const outcome = await sendScene(scene, presetById(scene.preset)!);
      if (outcome.status === 'sent') sent++;
      setRows(current => current?.map(row => row.key === scene.id ? {...row, ...outcome} : row) ?? current);
    }
    sendingRef.current = false;
    setSending(false);
    if (tried) notify(`${sent} de ${tried} cenas enviadas.`, sent < tried);
  };

  return (
    <div className="scenes-page">
      <div className="page-head">
        <div>
          <h1>Cenas</h1>
          <p className="muted">Um conto em cenas: cada cena usa um pedido salvo e as fichas das pessoas. Cada cena gera uma imagem.</p>
        </div>
      </div>
      {presetsFailed && <p className="help">Não foi possível carregar os pedidos salvos. Atualize a página para tentar de novo.</p>}
      {fichasFailed && <p className="help">Não foi possível carregar as fichas. Atualize a página para tentar de novo.</p>}
      <section className="card" aria-label="Conto">
        <div className="field">
          <label htmlFor="story-title">Título do conto <span className="muted">· opcional</span></label>
          <input id="story-title" value={story.title} maxLength={120} placeholder="Ex.: O inverno da Ana"
                 onChange={e => setStory(current => ({...current, title: e.target.value}))} />
        </div>
      </section>

      {!story.scenes.length && <div className="stage-empty">Nenhuma cena ainda. Adicione a primeira.</div>}
      <ol className="scene-list">
        {story.scenes.map((scene, index) => (
          <SceneCard key={scene.id} scene={scene} number={index + 1} count={story.scenes.length}
                     presets={presets} fichas={fichas} disabled={sending}
                     onChange={change => patch(scene.id, change)} onMove={delta => move(index, delta)}
                     onDuplicate={() => duplicate(index)} onRemove={() => edit(list => list.filter(s => s.id !== scene.id))} />
        ))}
      </ol>

      <div className="row">
        <button className="secondary" disabled={sending} onClick={() => edit(list => [...list, newScene()])}>
          <Icon name="plus" size={14} />Adicionar cena</button>
        <span className="spacer" />
        <button className="primary" disabled={!sendable.length || sending} onClick={() => void generateAll()}
                title="Envia uma geração por cena com pedido de geração, na ordem da lista. Cenas de edição ficam de fora.">
          {sending ? 'Enviando…' : `Gerar todas (${sendable.length} ${sendable.length === 1 ? 'cena' : 'cenas'})`}</button>
      </div>

      {rows && <SceneResults rows={rows} onOpenRun={onOpenRun} />}
    </div>
  );
}

interface CardProps {
  scene: Scene;
  number: number;
  count: number;
  presets: SavedRequest[] | null;
  fichas: SavedCharacter[] | null;
  disabled: boolean;
  onChange: (change: Partial<Scene>) => void;
  onMove: (delta: number) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}

function SceneCard({scene, number, count, presets, fichas, disabled, onChange, onMove, onDuplicate, onRemove}: CardProps) {
  const preset = presets?.find(p => p.id === scene.preset) ?? null;
  const taken = new Set([scene.main, ...scene.people.map(p => p.character)]);
  const setPerson = (index: number, change: Partial<ScenePerson>) =>
    onChange({people: scene.people.map((p, i) => i === index ? {...p, ...change} : p)});
  const fichaOptions = (current: string | null) => fichas?.map(c => (
    <option key={c.id} value={c.id} disabled={c.id !== current && taken.has(c.id)}>{c.name}</option>
  ));
  const id = `scene-${scene.id}`;

  return (
    <li className="card scene-card">
      <div className="section-title scene-head">
        <h2>Cena {number}</h2>
        <span className="spacer" />
        <button className="quiet" disabled={disabled || number === 1} onClick={() => onMove(-1)}
                title="Troca esta cena com a anterior">Subir</button>
        <button className="quiet" disabled={disabled || number === count} onClick={() => onMove(1)}
                title="Troca esta cena com a seguinte">Descer</button>
        <button className="quiet" disabled={disabled} onClick={onDuplicate}
                title="Cria uma cópia desta cena logo depois dela">Duplicar</button>
        <button className="quiet stop" disabled={disabled} onClick={onRemove} title="Tira esta cena do conto">Remover</button>
      </div>

      <div className="field">
        <label htmlFor={`${id}-preset`}>Pedido salvo</label>
        <select id={`${id}-preset`} value={scene.preset} disabled={disabled} onChange={e => onChange({preset: e.target.value})}
                title="O pedido salvo na tela Criar: estilo, cenário, pose e demais escolhas da cena.">
          <option value="">{presets === null ? 'Carregando…' : presets.length ? 'Escolha um pedido' : 'Nenhum pedido salvo'}</option>
          {presets?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {preset?.request.mode === 'edit' && <ul className="field-issues"><li>{EDIT_PRESET_WARNING}</li></ul>}
      </div>

      <div className="field">
        <label htmlFor={`${id}-main`}>Pessoa principal <span className="muted">· opcional</span></label>
        <select id={`${id}-main`} value={scene.main ?? ''} disabled={disabled}
                onChange={e => onChange({main: e.target.value || null})}
                title="A primeira pessoa da cena: rosto, corpo, pele e cabelo vêm da foto principal da ficha.">
          <option value="">Nenhuma</option>
          {fichaOptions(scene.main)}
        </select>
      </div>

      <div className="field">
        <span className="control-label">Outras pessoas <span className="muted">· até {EXTRA_PEOPLE_MAX}</span></span>
        {scene.people.map((person, index) => (
          <div className="saved-row" key={index}>
            <select aria-label={`Pessoa ${index + 2} da cena ${number}`} value={person.character} disabled={disabled}
                    onChange={e => setPerson(index, {character: e.target.value})}>
              <option value="">Escolha uma ficha</option>
              {fichaOptions(person.character)}
            </select>
            <select aria-label={`Posição da pessoa ${index + 2} da cena ${number}`} value={person.position ?? ''} disabled={disabled}
                    title="Onde a pessoa fica na imagem, olhando a foto de frente."
                    onChange={e => setPerson(index, {position: (e.target.value || null) as CharacterPosition | null})}>
              {POSITIONS.map(option => <option key={option.label} value={option.value ?? ''}>{option.label}</option>)}
            </select>
            <button className="quiet" disabled={disabled}
                    onClick={() => onChange({people: scene.people.filter((_, i) => i !== index)})}>Tirar</button>
          </div>
        ))}
        {scene.people.length < EXTRA_PEOPLE_MAX && (
          <div className="row">
            <button className="quiet" disabled={disabled}
                    onClick={() => onChange({people: [...scene.people, {character: '', position: null}]})}>Adicionar pessoa</button>
          </div>
        )}
      </div>

      <div className="field">
        <label htmlFor={`${id}-note`}>Detalhe desta cena <span className="muted">· opcional, em inglês</span></label>
        <textarea id={`${id}-note`} rows={2} maxLength={4000} value={scene.note} disabled={disabled}
                  placeholder="Ex.: a blue ceramic mug on the table"
                  title="Entra no campo Detalhes extras do pedido desta cena."
                  onChange={e => onChange({note: e.target.value})} />
      </div>
    </li>
  );
}

function SceneResults({rows, onOpenRun}: {rows: SceneRow[]; onOpenRun: (id: string) => void}) {
  const [runs, setRuns] = useState<Record<string, Run>>({});
  const idsKey = rows.map(row => row.runId).filter(Boolean).join(',');

  // Each sent scene is followed until its run ends, every 2 s; stopped when the screen closes.
  useEffect(() => {
    if (!idsKey) return;
    const open = new Set(idsKey.split(','));
    let stopped = false, timer: number | undefined;
    const tick = async () => {
      await Promise.all([...open].map(async id => {
        try {
          const run = await api.run(id);
          if (stopped) return;
          setRuns(current => ({...current, [id]: run}));
          if (TERMINAL.has(run.status)) open.delete(id);
        } catch {
          /* a failed poll is tried again on the next round */
        }
      }));
      if (!stopped && open.size) timer = window.setTimeout(tick, 2000);
    };
    tick();
    return () => {stopped = true; window.clearTimeout(timer);};
  }, [idsKey]);

  return (
    <section className="card" aria-labelledby="scene-results-title">
      <div className="section-title">
        <h2 id="scene-results-title">Resultado das cenas</h2>
      </div>
      <ol className="scene-results">
        {rows.map(row => <SceneResultRow key={row.key} row={row} run={row.runId ? runs[row.runId] : undefined} onOpenRun={onOpenRun} />)}
      </ol>
    </section>
  );
}

function SceneResultRow({row, run, onOpenRun}: {row: SceneRow; run?: Run; onOpenRun: (id: string) => void}) {
  const image = run?.images.find(i => i.files.length)?.files[0];
  const state = row.status === 'working' ? 'Preparando'
    : row.status === 'sent' ? (run ? RUN_STATUS[run.status] ?? run.status : 'Na fila do Studio')
    : row.status === 'skipped' ? 'Pulada' : 'Não enviada';
  const failed = !!run && ['failed', 'cancelled', 'lost'].includes(run.status);

  return (
    <li className="scene-row">
      <div className="compare-image">
        {image ? (
          <a href={fileUrl(image)} target="_blank" rel="noreferrer" title="Abrir em tamanho real">
            <img src={fileUrl(image)} alt={`Cena ${row.number}: ${row.label}`} /></a>
        ) : (
          <div className="compare-placeholder"><span>{state}</span></div>
        )}
      </div>
      <div className="scene-row-body">
        <strong>Cena {row.number} · {row.label}</strong>
        {(image || row.status === 'sent') && <span className="muted small">{state}</span>}
        {row.message && <p className={'issue ' + (row.status === 'skipped' ? 'warning' : 'error')}>{row.message}</p>}
        {!!row.issues?.length && <ul className="field-issues">{row.issues.map((text, i) => <li key={i}>{text}</li>)}</ul>}
        {failed && run?.error && <p className="issue error">{run.error}</p>}
        {row.runId && (
          <div className="row">
            <button className="quiet" onClick={() => onOpenRun(row.runId!)}>Abrir no Studio</button>
          </div>
        )}
      </div>
    </li>
  );
}
