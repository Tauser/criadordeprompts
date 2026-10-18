import {useEffect, useRef, useState} from 'react';
import {api} from '../api/client';

const MAX_LENGTH = 4000;

interface Props {
  text: string;                               // the field's current value
  onTranslated: (text: string) => void;       // replaces the field's value
  label: string;                              // what the field is, for the button's accessible name
  disabled?: boolean;
}

// "Traduzir para inglês" for any prompt field. The result replaces the field only if it still holds the text that
// was sent; the previous text can be restored with one click until the field is edited again.
export function TranslateButton({text, onTranslated, label, disabled}: Props) {
  const [state, setState] = useState<'idle' | 'working' | 'error'>('idle');
  const [error, setError] = useState('');
  const [undo, setUndo] = useState<{before: string; after: string} | null>(null);
  const latest = useRef(text);
  latest.current = text;
  const job = useRef<{id?: string; cancelled: boolean} | null>(null);

  useEffect(() => () => {                     // leaving the field drops the translation
    const pending = job.current;
    job.current = null;
    if (pending) {pending.cancelled = true; if (pending.id) api.cancelTranslation(pending.id).catch(() => undefined);}
  }, []);
  useEffect(() => {if (undo && text !== undo.after) setUndo(null);}, [text, undo]);

  const source = text.trim();
  const tooLong = source.length > MAX_LENGTH;

  const start = async () => {
    if (!source || tooLong || job.current) return;
    const mine: {id?: string; cancelled: boolean} = {cancelled: false};
    job.current = mine;
    setState('working'); setError(''); setUndo(null);
    try {
      const created = await api.translate(source);
      mine.id = created.id;
      if (mine.cancelled) {api.cancelTranslation(created.id).catch(() => undefined); return;}
      for (let i = 0; i < 240; i++) {
        await new Promise(r => setTimeout(r, 1500));
        if (mine.cancelled) return;
        const status = await api.translation(created.id);
        if (mine.cancelled) return;
        if (status.status === 'completed' && status.text) {
          const before = latest.current;
          if (before.trim() !== source
              && !confirm(`O campo mudou durante a tradução. Substituir pelo texto traduzido?\n\n${status.text}`)) {
            setState('idle'); return;
          }
          onTranslated(status.text);
          setUndo({before, after: status.text});
          setState('idle');
          return;
        }
        if (status.status === 'failed' || status.status === 'cancelled') throw new Error(status.error || 'A tradução falhou.');
      }
      throw new Error('A tradução demorou demais.');
    } catch (e) {
      if (mine.cancelled) return;
      setError((e as Error).message); setState('error');
    } finally {
      if (job.current === mine) job.current = null;
    }
  };
  const cancel = () => {
    const pending = job.current;
    job.current = null;
    if (pending) {pending.cancelled = true; if (pending.id) api.cancelTranslation(pending.id).catch(() => undefined);}
    setState('idle');
  };

  return (
    <span className="translate">
      {state === 'working' ? <>
        <span className="muted small">Traduzindo no modelo local…</span>
        <button type="button" className="btn-link" onClick={cancel} aria-label={`Cancelar tradução de ${label}`}>Cancelar</button>
      </> : <button type="button" className="btn-link" disabled={disabled || !source || tooLong} onClick={start}
                    aria-label={`Traduzir ${label} para inglês`}
                    title={tooLong ? 'Texto longo demais para traduzir (máximo de 4.000 caracteres).' : 'Traduz o texto deste campo para inglês'}>
        Traduzir para inglês</button>}
      {undo && <button type="button" className="btn-link" aria-label={`Desfazer tradução de ${label}`}
                       onClick={() => {onTranslated(undo.before); setUndo(null);}}>Desfazer</button>}
      {state === 'error' && <span className="translate-error" role="alert">{error}</span>}
    </span>
  );
}
