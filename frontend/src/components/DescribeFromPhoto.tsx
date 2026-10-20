import {useEffect, useRef, useState} from 'react';
import {api, fileUrl} from '../api/client';
import type {ReferenceDraft, TextFinding} from '../api/types';

const POLL_MS = 1500, MAX_POLLS = 240;

interface Props {
  category: 'pose' | 'action';
  onDraft: (draft: ReferenceDraft, findings: TextFinding[]) => void;   // fills the editor; saving is up to the person
}

// "Descrever a partir da foto": the local text-and-vision model drafts the texts and metadata of a new pose or action.
// The editor keys this by item, so opening another item or closing the editor cancels the description.
export function DescribeFromPhoto({category, onDraft}: Props) {
  const [photo, setPhoto] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'uploading' | 'working' | 'repairing'>('idle');
  const [error, setError] = useState('');
  const job = useRef<{id?: string; cancelled: boolean} | null>(null);
  const report = useRef(onDraft);
  report.current = onDraft;

  const stop = () => {
    const pending = job.current;
    job.current = null;
    if (pending) {pending.cancelled = true; if (pending.id) api.cancelReferenceDescription(pending.id).catch(() => undefined);}
  };
  useEffect(() => stop, []);

  const choose = async (file: File | undefined) => {
    if (!file) return;
    stop();
    setError(''); setState('uploading');
    try {
      setPhoto((await api.upload(file, file.name)).hash);
    } catch (e) {setError((e as Error).message);} finally {setState('idle');}
  };

  const describe = async () => {
    if (!photo || job.current) return;
    const mine: {id?: string; cancelled: boolean} = {cancelled: false};
    job.current = mine;
    setError(''); setState('working');
    try {
      let status = await api.describeReference(photo, category);
      mine.id = status.id;
      for (let i = 0; i < MAX_POLLS && (status.status === 'queued' || status.status === 'running'); i++) {
        if (mine.cancelled) return;
        setState(status.stage === 'repair' ? 'repairing' : 'working');
        await new Promise(r => setTimeout(r, POLL_MS));
        if (mine.cancelled) return;
        status = await api.referenceDescription(status.id);
      }
      if (mine.cancelled) return;
      if (status.status === 'completed' && status.draft) {report.current(status.draft, status.findings ?? []); return;}
      if (status.status === 'queued' || status.status === 'running') {
        api.cancelReferenceDescription(status.id).catch(() => undefined);
        throw new Error('A descrição demorou demais.');
      }
      throw new Error(status.error || 'A descrição não terminou.');
    } catch (e) {
      if (!mine.cancelled) setError((e as Error).message);
    } finally {
      if (job.current === mine) {job.current = null; setState('idle');}
    }
  };
  const cancel = () => {stop(); setState('idle');};

  const busy = state !== 'idle';
  return (
    <div className="describe-photo" role="group" aria-label="Descrever a partir da foto">
      {photo && <img src={fileUrl(photo)} alt="Foto de referência" />}
      <div className="describe-photo-actions">
        <label className={'button secondary small' + (busy ? ' disabled' : '')}
               title="O modelo local descreve a pose da foto e preenche um rascunho. Nada é salvo antes de você revisar.">
          {state === 'uploading' ? 'Enviando…' : photo ? 'Trocar foto' : 'Foto de referência'}
          <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} aria-label="Escolher foto de referência"
                 onChange={e => {choose(e.target.files?.[0]); e.target.value = '';}} />
        </label>
        {state === 'working' || state === 'repairing' ? <>
          <span className="muted small">{state === 'repairing' ? 'Ajustando a redação…' : 'Descrevendo no modelo local…'}</span>
          <button type="button" className="btn-link" onClick={cancel}>Cancelar</button>
        </> : <button type="button" className="btn-link" disabled={!photo || busy} onClick={describe}>Descrever a partir da foto</button>}
      </div>
      {error && <span className="translate-error" role="alert">{error}</span>}
    </div>
  );
}
