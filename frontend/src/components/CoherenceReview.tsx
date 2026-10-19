import {useEffect, useRef, useState} from 'react';
import {api} from '../api/client';
import type {CoherenceJob, StudioRequest} from '../api/types';

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

interface Props {
  request: StudioRequest;
  prompt: string | null;          // the prompt shown now; a review of another text is marked as outdated
  ready: boolean;                 // the request is valid and the preview is current
}

// On demand: the local text model reads the final prompt and points out contradictions the rules cannot see,
// such as free text. Advisory only; it never blocks a run.
export function CoherenceReview({request, prompt, ready}: Props) {
  const [job, setJob] = useState<CoherenceJob | null>(null);
  const [error, setError] = useState('');
  const active = useRef<{id?: string; cancelled: boolean} | null>(null);

  const stopPolling = () => {
    const pending = active.current;
    active.current = null;
    if (pending) {pending.cancelled = true; if (pending.id) api.cancelCoherence(pending.id).catch(() => undefined);}
  };
  useEffect(() => stopPolling, []);

  const start = async () => {
    if (active.current) return;
    const mine: {id?: string; cancelled: boolean} = {cancelled: false};
    active.current = mine;
    setError(''); setJob(null);
    try {
      let current = await api.reviewCoherence(request);
      mine.id = current.id;
      if (mine.cancelled) return;
      setJob(current);
      for (let i = 0; i < 240 && !TERMINAL.has(current.status); i++) {
        await new Promise(r => setTimeout(r, 1500));
        if (mine.cancelled) return;
        current = {...(await api.coherence(current.id)), prompt: current.prompt, omitted: current.omitted};
        if (mine.cancelled) return;
        setJob(current);
      }
      if (!TERMINAL.has(current.status)) setError('A análise demorou demais.');
    } catch (e) {
      if (!mine.cancelled) setError((e as Error).message);
    } finally {
      if (active.current === mine) active.current = null;
    }
  };
  const cancel = () => {stopPolling(); setJob(j => j && {...j, status: 'cancelled'});};

  const working = !!job && !TERMINAL.has(job.status);
  const result = job?.status === 'completed' ? job.result : undefined;
  const outdated = !!job?.prompt && job.prompt !== prompt;
  return (
    <div className="coherence">
      <div className="row">
        {working
          ? <><span className="muted small">Analisando no modelo local…</span><button className="btn-link" onClick={cancel}>Cancelar</button></>
          : <button className="quiet" disabled={!ready} onClick={start}
                    title="O modelo de texto local lê o prompt final e aponta contradições, inclusive no texto livre">
              Analisar coerência com o modelo</button>}
      </div>
      {error && <p className="issue error">{error}</p>}
      {job?.status === 'failed' && <p className="issue error">{job.error || 'A análise falhou.'}</p>}
      {result && <>
        {outdated && <p className="muted small">O prompt mudou depois desta análise. Analise de novo para conferir a versão atual.</p>}
        {result.coherent === true && <p className="issue ok">O modelo não encontrou incoerências.</p>}
        {result.issues.length > 0 && <ul className="issues">{result.issues.map((issue, i) => (
          <li key={i} className={'issue ' + issue.severity}>
            <span className="level">{issue.severity === 'error' ? 'Incoerente' : 'Ambíguo'}</span>
            {issue.problem}
            {issue.quote && <q className="quote">{issue.quote}</q>}
            {issue.suggestion && <span className="suggestion">Sugestão: {issue.suggestion}</span>}
          </li>))}</ul>}
        {result.raw && <details className="raw"><summary>O modelo respondeu fora do formato esperado</summary><pre>{result.raw}</pre></details>}
        {result.truncated && <p className="muted small">A resposta do modelo veio cortada; aparecem só os apontamentos completos.</p>}
        {!!job?.omitted && <p className="muted small">{job.omitted === 1 ? 'Uma instrução de opção adulta ficou'
          : `${job.omitted} instruções de opções adultas ficaram`} fora da análise: ela revisa a coerência, não o tema.</p>}
        {!!result.dropped && <p className="muted small">{result.dropped === 1 ? 'Um apontamento sobre o tema, e não sobre a coerência, foi descartado'
          : `${result.dropped} apontamentos sobre o tema, e não sobre a coerência, foram descartados`}.</p>}
        <p className="help">Análise consultiva do modelo local: pode errar e não bloqueia a geração.</p>
      </>}
    </div>
  );
}
