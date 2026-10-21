import {useEffect, useRef, useState} from 'react';
import {api, fileUrl} from '../api/client';
import type {PeopleDetection} from '../lib/usePeopleCount';
import {uuid} from '../lib/uuid';
import {describeSwapBody, removeSwap, setSwap, type Workspace} from '../state/workspace';
import {Tip} from './Controls';

const POLL_MS = 1200, MAX_POLLS = 100;
const PLACES: Record<number, string[]> = {1: ['a pessoa da foto'], 2: ['à esquerda', 'à direita'],
  3: ['à esquerda', 'no centro', 'à direita']};

export const placeName = (position: number, total: number) =>
  PLACES[total]?.[position - 1] ?? `${position}ª a partir da esquerda`;

interface Props {
  workspace: Workspace;
  detection: PeopleDetection | null;
  update: (next: Workspace | ((ws: Workspace) => Workspace)) => void;
  notify: (message: string, error?: boolean) => void;
  disabled?: boolean;
}

// "Trocar pessoas": each person of the edited photo, counted from the left, can become the person of another photo.
// The Studio crops head and shoulders of that photo (a reference that shows arms or a pose gets copied into the scene)
// and warns when the face is turned (a face in profile does not carry the identity).
export function SwapPeople({workspace, detection, update, notify, disabled}: Props) {
  const request = workspace.request;
  const swaps = request.swaps ?? [];
  const [open, setOpen] = useState(swaps.length > 0);
  const [working, setWorking] = useState<Record<number, string>>({});       // position -> what is happening
  const jobs = useRef<Record<number, {id?: string; cancelled: boolean}>>({});
  useEffect(() => () => {
    for (const job of Object.values(jobs.current)) {
      job.cancelled = true;
      if (job.id) api.cancelBust(job.id).catch(() => undefined);
    }
  }, []);
  useEffect(() => {if (swaps.length) setOpen(true);}, [swaps.length]);

  const target = request.target_id ? workspace.files[request.target_id] : undefined;
  if (request.mode !== 'edit' || !target) return null;
  const total = request.participants.existing ?? 0;
  const people = detection?.status === 'done' ? detection.people ?? [] : [];

  const choose = async (position: number, file: File | undefined) => {
    if (!file) return;
    jobs.current[position]?.id && api.cancelBust(jobs.current[position].id!).catch(() => undefined);
    const mine = {cancelled: false} as {id?: string; cancelled: boolean};
    jobs.current[position] = mine;
    const done = () => setWorking(w => {const next = {...w}; delete next[position]; return next;});
    setWorking(w => ({...w, [position]: 'Enviando a foto…'}));
    try {
      const stored = await api.upload(file, file.name);
      if (mine.cancelled) return;
      setWorking(w => ({...w, [position]: 'Recortando o rosto…'}));
      let job = await api.cropBust(stored.hash);
      mine.id = job.id;
      for (let i = 0; i < MAX_POLLS && !mine.cancelled && (job.status === 'queued' || job.status === 'running'); i++) {
        await new Promise(r => setTimeout(r, POLL_MS));
        if (!mine.cancelled) job = await api.bust(job.id);
      }
      if (mine.cancelled) return;
      if (job.status !== 'completed' || !job.hash) throw new Error(job.error || 'Não foi possível recortar o rosto desta foto.');
      const id = 'swap-' + uuid().slice(0, 8);
      update(ws => setSwap(ws, position, id, {hash: job.hash!, width: job.width ?? 0, height: job.height ?? 0,
        name: `Pessoa ${position} · ${file.name}`}, {turn: job.turn ?? null, frontal: !!job.frontal, name: file.name}));
    } catch (error) {
      if (!mine.cancelled) notify((error as Error).message, true);
    } finally {
      if (jobs.current[position] === mine) {delete jobs.current[position]; done();}
    }
  };
  const cancel = (position: number) => {
    const job = jobs.current[position];
    if (!job) return;
    job.cancelled = true;
    if (job.id) api.cancelBust(job.id).catch(() => undefined);
    delete jobs.current[position];
    setWorking(w => {const next = {...w}; delete next[position]; return next;});
  };

  return (
    <section className="card swap-people" aria-labelledby="swap-title">
      <div className="section-title">
        <h2 id="swap-title">Trocar pessoas</h2>
        <Tip label="Como funciona a troca">Cada pessoa da foto, contada da esquerda, pode virar a pessoa de outra foto: a
          pose, as mãos, a roupa e o cenário ficam. Use fotos de frente e nítidas. A expressão da foto escolhida tende a
          passar para a cena: prefira expressão neutra ou sorrindo, ou escolha uma em Expressão.</Tip>
        <span className="spacer" />
        <button type="button" className="quiet small" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Fechar' : swaps.length ? `${swaps.length} ${swaps.length === 1 ? 'troca' : 'trocas'}` : 'Abrir'}</button>
      </div>
      {open && <>
        {!total && <p className="muted small">{detection?.status === 'counting' ? 'Contando as pessoas da foto…'
          : 'Informe quantas pessoas há na foto (em Pessoas na foto) para escolher quem trocar.'}</p>}
        {total > 0 && <div className="swap-layout">
          <figure className="swap-scene">
            <img src={fileUrl(target.hash)} alt="Foto editada" />
            {people.length === total && people.map((p, i) => (
              <span key={i} className="swap-marker" aria-hidden="true"
                    style={{left: `${(p.x + p.width / 2) * 100}%`, top: `${Math.max(0, p.y) * 100}%`}}>{i + 1}</span>))}
          </figure>
          <ol className="swap-list">
            {Array.from({length: total}, (_, i) => i + 1).map(position => {
              const swap = swaps.find(s => s.position === position);
              const info = swap ? workspace.swapInfo?.[swap.reference_id] : undefined;
              const file = swap ? workspace.files[swap.reference_id] : undefined;
              const busy = working[position];
              const name = `Pessoa ${position} (${placeName(position, total)})`;
              return (
                <li key={position} className="swap-row">
                  <div className="swap-head">
                    <strong>{position}</strong>
                    <span className="muted small">{placeName(position, total)}</span>
                    {file && <img src={fileUrl(file.hash)} alt={`Nova pessoa ${position}`} />}
                    {busy ? <>
                      <span className="muted small">{busy}</span>
                      <button type="button" className="btn-link" onClick={() => cancel(position)}>Cancelar</button>
                    </> : <>
                      <label className={'button secondary small' + (disabled ? ' disabled' : '')}
                             title="Foto da pessoa nova, de preferência de frente e com o rosto nítido. O Studio usa só a cabeça e os ombros.">
                        {swap ? 'Trocar foto' : 'Escolher foto'}
                        <input type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled}
                               aria-label={`Escolher a foto da ${name}`}
                               onChange={e => {choose(position, e.target.files?.[0]); e.target.value = '';}} />
                      </label>
                      {swap && <button type="button" className="btn-link" disabled={disabled}
                                       onClick={() => update(ws => removeSwap(ws, position))}>Manter a original</button>}
                    </>}
                  </div>
                  {info && !info.frontal && <p className="swap-warning">
                    {info.turn == null ? 'Não deu para medir para onde o rosto está virado.'
                      : `O rosto está virado ${info.turn}°.`} A troca funciona melhor com uma foto de frente.</p>}
                  {swap && <input className="swap-body" value={swap.body} maxLength={300} disabled={disabled}
                                  placeholder="Corpo (opcional, em inglês): slim and tall"
                                  aria-label={`Corpo da ${name}, em inglês`}
                                  title="A foto não leva o corpo de forma confiável: descreva aqui se quiser, por exemplo 'slim and tall' ou 'athletic build'."
                                  onChange={e => {const body = e.target.value; update(ws => describeSwapBody(ws, position, body));}} />}
                </li>
              );
            })}
          </ol>
        </div>}
      </>}
    </section>
  );
}
