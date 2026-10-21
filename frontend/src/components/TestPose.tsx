import {useEffect, useRef, useState} from 'react';
import {api, poseTestUrl} from '../api/client';
import type {Item} from '../api/types';

const POLL_MS = 1500, MAX_POLLS = 240;

// "Testar pose": a quick Turbo image (8 steps, 1024 px) of a neutral person in a neutral studio, made only from the
// English description of the open draft. Nothing is saved: not in the library and not in the history.
// The editor keys this by item, so opening another item or closing the editor cancels the test.
export function TestPose({item}: {item: Item}) {
  const [state, setState] = useState<'idle' | 'working'>('idle');
  const [result, setResult] = useState<{id: string; prompt: string} | null>(null);
  const [error, setError] = useState('');
  const [adultMode, setAdultMode] = useState(false);
  const [adultsOnly, setAdultsOnly] = useState(false);
  const job = useRef<{id?: string; cancelled: boolean} | null>(null);

  const stop = () => {
    const pending = job.current;
    job.current = null;
    if (pending) {pending.cancelled = true; if (pending.id) api.cancelPoseTest(pending.id).catch(() => undefined);}
  };
  useEffect(() => stop, []);

  const blocked = !item.prompt.trim() ? 'Preencha a descrição em inglês para testar.'
    : item.adult && !(adultMode && adultsOnly) ? 'Para testar uma opção adulta, confirme as duas caixas acima.' : '';

  const run = async () => {
    if (blocked || job.current) return;
    const mine: {id?: string; cancelled: boolean} = {cancelled: false};
    job.current = mine;
    const prompt = item.prompt;
    // Only the wording is under test: the name and the optional texts are not needed by the preview.
    const sent: Item = {...item, label: item.label.trim() || 'Teste', edit_prompt: null};
    setError(''); setState('working');
    try {
      let status = await api.testPose(sent, item.adult ? 'adult' : 'standard', item.adult ? ['adults_only'] : []);
      mine.id = status.id;
      for (let i = 0; i < MAX_POLLS && (status.status === 'queued' || status.status === 'running'); i++) {
        if (mine.cancelled) return;
        await new Promise(r => setTimeout(r, POLL_MS));
        if (mine.cancelled) return;
        status = await api.poseTest(status.id);
      }
      if (mine.cancelled) return;
      if (status.status === 'completed' && status.has_image) {setResult({id: status.id, prompt}); return;}
      if (status.status === 'queued' || status.status === 'running') {
        api.cancelPoseTest(status.id).catch(() => undefined);
        throw new Error('O teste demorou demais.');
      }
      throw new Error(status.error || 'O teste não terminou.');
    } catch (e) {
      if (!mine.cancelled) setError((e as Error).message);
    } finally {
      if (job.current === mine) {job.current = null; setState('idle');}
    }
  };
  const cancel = () => {stop(); setState('idle');};

  return (
    <div className="test-pose" role="group" aria-label="Testar pose">
      {item.adult && <>
        <label className="check"><input type="checkbox" checked={adultMode} onChange={e => setAdultMode(e.target.checked)} />
          Testar com conteúdo adulto (+18)</label>
        <label className="check"><input type="checkbox" checked={adultsOnly} onChange={e => setAdultsOnly(e.target.checked)} />
          Confirmo que todas as pessoas retratadas são adultas.</label>
      </>}
      <div className="describe-photo-actions">
        {state === 'working' ? <>
          <span className="muted small">Gerando a prévia (Turbo)…</span>
          <button type="button" className="btn-link" onClick={cancel}>Cancelar</button>
        </> : <button type="button" className="btn-link" disabled={!!blocked} onClick={run}
                      title="Gera uma prévia rápida (Turbo, 8 passos, 1024 px) só com a descrição em inglês, com uma pessoa neutra num estúdio cinza. Nada é salvo, nem no Histórico.">
          Testar pose</button>}
      </div>
      {blocked && item.adult && item.prompt.trim() && <span className="muted small">{blocked}</span>}
      {error && <span className="translate-error" role="alert">{error}</span>}
      {result && <figure>
        <img src={poseTestUrl(result.id)} alt="Prévia da pose" />
        {result.prompt !== item.prompt && <figcaption className="muted small">Feita com o texto anterior. Teste de novo para ver a versão atual.</figcaption>}
      </figure>}
    </div>
  );
}
