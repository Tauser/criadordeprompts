import {useEffect, useRef, useState} from 'react';
import {ApiError, api, fileUrl} from '../api/client';
import type {CharacterPosition, Issue, Run, SavedCharacter, SavedRequest} from '../api/types';
import {RUN_STATUS, TERMINAL} from '../lib/labels';
import {uuid} from '../lib/uuid';
import {buildSceneRequest, EXTRA_PEOPLE_MAX, loadStory, newScene, NO_PHOTO_WARNING, POSITIONS, photoSize, resultHash, saveStory,
  type Scene, type SceneInput, type ScenePerson, type ScenePhoto, type Story} from '../lib/scenes';
import {Icon} from './Icon';

interface Props {
  notify: (message: string, error?: boolean) => void;
  onOpenRun: (id: string) => void;     // opens the run in the Studio view, as the History does
}

// What became of one scene in the last "Gerar todas". `message` is its progress while it waits, or why it did not go.
type RowStatus = 'working' | 'sent' | 'skipped' | 'error';
interface SceneRow {key: string; number: number; label: string; status: RowStatus; runId?: string; message?: string; issues?: string[]}
type PhotoChoice = {photo: ScenePhoto} | {skip: string};
interface Source {id: string; number: number}   // an earlier scene whose result can be the photo of this one

const RUN_POLL_MS = 2000, RUN_POLLS = 1800;      // about an hour at most
const PEOPLE_POLL_MS = 1500, PEOPLE_POLLS = 80;
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Follows a run until it ends, as the results list does. Null when it does not end in time.
async function finishedRun(id: string): Promise<Run | null> {
  for (let i = 0; i < RUN_POLLS; i++) {
    try {
      const run = await api.run(id);
      if (TERMINAL.has(run.status)) return run;
    } catch {
      /* a failed poll is tried again */
    }
    await wait(RUN_POLL_MS);
  }
  return null;
}

// The people in the photo, counted by the server as the form does; null when no count comes back.
async function countPeopleInPhoto(hash: string): Promise<number | null> {
  try {
    let job = await api.countPeople(hash);
    for (let i = 0; i < PEOPLE_POLLS && (job.status === 'queued' || job.status === 'running'); i++) {
      await wait(PEOPLE_POLL_MS);
      job = await api.peopleCount(job.id);
    }
    return job.status === 'completed' && job.count ? job.count : null;
  } catch {
    return null;
  }
}

// "Cenas do conto": a story of scenes. Each scene is a saved request with its people (fichas); "Gerar todas" sends one
// generation or edit per scene, in order, and follows each run until it ends.
export function Scenes({notify, onOpenRun}: Props) {
  const [story, setStory] = useState<Story>(loadStory);
  const [presets, setPresets] = useState<SavedRequest[] | null>(null);
  const [presetsFailed, setPresetsFailed] = useState(false);
  const [fichas, setFichas] = useState<SavedCharacter[] | null>(null);
  const [fichasFailed, setFichasFailed] = useState(false);
  const [rows, setRows] = useState<SceneRow[] | null>(null);
  const [runs, setRuns] = useState<Record<string, Run>>({});
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const idsKey = (rows ?? []).map(row => row.runId).filter(Boolean).join(',');

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

  const presetById = (id: string) => presets?.find(p => p.id === id) ?? null;
  const fichaById = (id: string | null) => fichas?.find(c => c.id === id) ?? null;
  const sendable = story.scenes.filter(scene => presetById(scene.preset));

  // The picture a scene made in the last "Gerar todas", when it has finished.
  const finishedHash = (sceneId: string): string | null => {
    const runId = rows?.find(row => row.key === sceneId)?.runId;
    const run = runId ? runs[runId] : undefined;
    return run?.status === 'completed' ? resultHash(run) : null;
  };
  const sourcesBefore = (index: number): Source[] => story.scenes.slice(0, index)
    .map((scene, i) => ({id: scene.id, number: i + 1}))
    .filter(source => finishedHash(source.id));

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
  // An edit has no main person: the photo is the person, so the ficha of the main person is not read.
  const inputFor = (scene: Scene, preset: SavedRequest): SceneInput => {
    const isEdit = preset.request.mode === 'edit';
    const main = isEdit || !scene.main ? null : fichaById(scene.main);
    if (!isEdit && scene.main && !main) throw new Error('A ficha da pessoa principal não foi encontrada.');
    const people = scene.people.map((person: ScenePerson) => {
      if (!person.character) throw new Error('Escolha a ficha de cada outra pessoa da cena.');
      const character = fichaById(person.character);
      if (!character) throw new Error('Uma ficha desta cena não foi encontrada.');
      return {character, position: person.position};
    });
    return {preset, main, people, note: scene.note};
  };

  // The photo an edit scene edits: its own, or the picture of an earlier scene, which is waited for when it is still running.
  const photoFor = async (scene: Scene, index: number, runIds: Record<string, string>,
                          progress: (message: string) => void): Promise<PhotoChoice> => {
    if (!scene.fromScene) return scene.photo ? {photo: scene.photo} : {skip: NO_PHOTO_WARNING};
    const source = story.scenes.findIndex(s => s.id === scene.fromScene);
    if (source < 0 || source >= index) return {skip: NO_PHOTO_WARNING};
    const number = source + 1;
    const runId = runIds[story.scenes[source].id];
    if (!runId) return {skip: `A cena ${number} não gerou imagem.`};
    progress(`Esperando a cena ${number} terminar.`);
    const run = await finishedRun(runId);
    const hash = run?.status === 'completed' ? resultHash(run) : null;
    if (!hash) return {skip: `A cena ${number} não gerou imagem.`};
    const {width, height} = await photoSize(hash);
    return {photo: {hash, width, height, name: `Cena ${number}`}};
  };

  // One scene: the same check the form makes (prepare) before the run is created. Its failure stays on its row.
  const sendScene = async (scene: Scene, index: number, runIds: Record<string, string>,
                           progress: (message: string) => void): Promise<Partial<SceneRow>> => {
    const preset = presetById(scene.preset)!;
    try {
      let input = inputFor(scene, preset);
      let notice: string | undefined;
      if (preset.request.mode === 'edit') {
        const choice = await photoFor(scene, index, runIds, progress);
        if ('skip' in choice) return {status: 'skipped', message: choice.skip};
        const counted = await countPeopleInPhoto(choice.photo.hash);
        input = {...input, photo: choice.photo, existing: counted ?? 1};
        if (!counted) notice = 'Confira quantas pessoas há na foto.';
      }
      const built = await buildSceneRequest(input);
      const prepared = await api.prepare(built.request);
      if (!prepared.valid) {
        return {status: 'error', message: 'A cena não passou na verificação do pedido.',
          issues: prepared.issues.filter(issue => issue.level === 'error').map(issue => issue.message)};
      }
      const created = await api.createRun({request_id: uuid(), request: built.request, files: built.files, mask: null});
      return {status: 'sent', runId: created.id, message: notice};
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
      if (preset.request.mode === 'edit' && !scene.photo && !scene.fromScene) return {...base, status: 'skipped', message: NO_PHOTO_WARNING};
      return {...base, status: 'working'};
    });
    setRows(initial);
    const runIds: Record<string, string> = {};   // scene id -> its run, for the scenes that edit an earlier result
    let tried = 0, sent = 0;
    for (let index = 0; index < story.scenes.length; index++) {
      const scene = story.scenes[index];
      if (initial[index].status !== 'working') continue;
      tried++;
      const progress = (message: string) =>
        setRows(current => current?.map(row => row.key === scene.id ? {...row, message} : row) ?? current);
      const outcome = await sendScene(scene, index, runIds, progress);
      if (outcome.runId) runIds[scene.id] = outcome.runId;
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
        {story.scenes.map((scene, index) => {
          const from = scene.fromScene ? story.scenes.findIndex(s => s.id === scene.fromScene) : -1;
          return (
            <SceneCard key={scene.id} scene={scene} number={index + 1} count={story.scenes.length}
                       presets={presets} fichas={fichas} disabled={sending}
                       sources={sourcesBefore(index)} photoHash={scene.photo?.hash ?? (scene.fromScene ? finishedHash(scene.fromScene) : null)}
                       fromNumber={from >= 0 ? from + 1 : null}
                       onChange={change => patch(scene.id, change)} onMove={delta => move(index, delta)}
                       onDuplicate={() => duplicate(index)} onRemove={() => edit(list => list.filter(s => s.id !== scene.id))} />
          );
        })}
      </ol>

      <div className="row">
        <button className="secondary" disabled={sending} onClick={() => edit(list => [...list, newScene()])}>
          <Icon name="plus" size={14} />Adicionar cena</button>
        <span className="spacer" />
        <button className="primary" disabled={!sendable.length || sending} onClick={() => void generateAll()}
                title="Envia uma geração ou edição por cena, na ordem da lista. Uma cena de edição precisa da foto a editar.">
          {sending ? 'Enviando…' : `Gerar todas (${sendable.length} ${sendable.length === 1 ? 'cena' : 'cenas'})`}</button>
      </div>

      {rows && <SceneResults rows={rows} runs={runs} onOpenRun={onOpenRun} />}
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
  sources: Source[];              // earlier scenes whose result has finished: they can be the photo
  photoHash: string | null;       // the picture shown for the photo to edit
  fromNumber: number | null;      // the number of the scene whose result is the photo
  onChange: (change: Partial<Scene>) => void;
  onMove: (delta: number) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}

function SceneCard({scene, number, count, presets, fichas, disabled, sources, photoHash, fromNumber, onChange, onMove, onDuplicate,
  onRemove}: CardProps) {
  const preset = presets?.find(p => p.id === scene.preset) ?? null;
  const isEdit = preset?.request.mode === 'edit';
  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const taken = new Set<string | null>([isEdit ? null : scene.main, ...scene.people.map(p => p.character)]);
  const setPerson = (index: number, change: Partial<ScenePerson>) =>
    onChange({people: scene.people.map((p, i) => i === index ? {...p, ...change} : p)});
  const fichaOptions = (current: string | null) => fichas?.map(c => (
    <option key={c.id} value={c.id} disabled={c.id !== current && taken.has(c.id)}>{c.name}</option>
  ));
  const id = `scene-${scene.id}`;

  const sendPhoto = async (list: FileList | null) => {
    const file = list?.[0];
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {setPhotoError('Use imagens PNG, JPEG ou WebP.'); return;}
    setUploading(true);
    setPhotoError(null);
    try {
      const stored = await api.upload(file, file.name);
      onChange({photo: {hash: stored.hash, width: stored.width, height: stored.height, name: file.name}, fromScene: null});
    } catch (error) {
      setPhotoError((error as Error).message);
    } finally {
      setUploading(false);
    }
  };

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
                title="O pedido salvo na tela Criar: estilo, cenário, pose e demais escolhas da cena. Um pedido de edição edita a foto abaixo.">
          <option value="">{presets === null ? 'Carregando…' : presets.length ? 'Escolha um pedido' : 'Nenhum pedido salvo'}</option>
          {presets?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {isEdit && (
        <div className="field">
          <span className="control-label" title="A foto que esta cena edita. Envie uma foto ou use o resultado de uma cena anterior do conto.">
            Foto a editar</span>
          {(photoHash || scene.fromScene) && (
            <div className="saved-row">
              {photoHash && <img className="mask-thumb" src={fileUrl(photoHash)} alt={`Foto a editar da cena ${number}`} />}
              <span className="muted small">{scene.fromScene ? (fromNumber ? `Resultado da cena ${fromNumber}` : 'Resultado de uma cena anterior')
                : scene.photo?.name}</span>
              <button className="quiet" disabled={disabled} onClick={() => onChange({photo: null, fromScene: null})}>Remover</button>
            </div>
          )}
          <div className="row">
            <label className={'button secondary small' + (disabled || uploading ? ' disabled' : '')}
                   title="Foto que esta cena edita. Use PNG, JPEG ou WebP.">
              <Icon name="upload" size={14} />{uploading ? 'Enviando…' : 'Enviar foto'}
              <input type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled || uploading}
                     aria-label={`Enviar foto da cena ${number}`}
                     onChange={e => {void sendPhoto(e.target.files); e.target.value = '';}} />
            </label>
            {sources.length > 0 && (
              <select aria-label={`Usar o resultado de uma cena anterior na cena ${number}`} value="" disabled={disabled || uploading}
                      title="Continua o conto: a foto desta cena é a imagem que uma cena anterior gerou."
                      onChange={e => {if (e.target.value) onChange({fromScene: e.target.value, photo: null});}}>
                <option value="">Usar o resultado de uma cena anterior…</option>
                {sources.map(source => <option key={source.id} value={source.id}>Usar o resultado da cena {source.number}</option>)}
              </select>
            )}
          </div>
          {photoError && <ul className="field-issues"><li>{photoError}</li></ul>}
          {!photoHash && !scene.fromScene && <ul className="field-issues"><li>{NO_PHOTO_WARNING}</li></ul>}
        </div>
      )}

      {!isEdit && (
        <div className="field">
          <label htmlFor={`${id}-main`}>Pessoa principal <span className="muted">· opcional</span></label>
          <select id={`${id}-main`} value={scene.main ?? ''} disabled={disabled}
                  onChange={e => onChange({main: e.target.value || null})}
                  title="A primeira pessoa da cena: rosto, corpo, pele e cabelo vêm da foto principal da ficha.">
            <option value="">Nenhuma</option>
            {fichaOptions(scene.main)}
          </select>
        </div>
      )}

      <div className="field">
        <span className="control-label"
              title={isEdit ? 'Numa edição, a foto a editar já é a pessoa principal. As fichas abaixo são adicionadas a ela.' : undefined}>
          Outras pessoas <span className="muted">· até {EXTRA_PEOPLE_MAX}</span></span>
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

function SceneResults({rows, runs, onOpenRun}: {rows: SceneRow[]; runs: Record<string, Run>; onOpenRun: (id: string) => void}) {
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
  const image = run ? resultHash(run) : null;
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
        {row.message && (row.status === 'working'
          ? <span className="muted small">{row.message}</span>
          : <p className={'issue ' + (row.status === 'error' ? 'error' : 'warning')}>{row.message}</p>)}
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
