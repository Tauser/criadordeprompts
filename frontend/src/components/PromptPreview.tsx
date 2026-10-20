import type {Issue, Prepared, StudioRequest} from '../api/types';
import {CATEGORY_LABELS} from '../lib/labels';
import {CoherenceReview} from './CoherenceReview';
import {TranslateButton} from './Translate';

interface Props {
  request: StudioRequest;
  prepared: Prepared | null;
  pending: boolean;
  error: string | null;
  onManual: (enabled: boolean) => void;
  onManualText: (text: string) => void;
  onFocusField: (field: string) => void;
}

const BLOCK_LABEL = (block: string) => {
  if (block.startsWith('op.')) return CATEGORY_LABELS[block.slice(3) as keyof typeof CATEGORY_LABELS] ?? block;
  if (block.startsWith('transfer.')) return 'Referência';
  if (block.startsWith('character.')) return `Personagem ${block.slice(10)}`;
  if (block.startsWith('guide.')) {
    const key = block.slice(6).split(':')[0];
    return ({posture: 'Postura', support: 'Apoio', new_supports: 'Apoio', orientation: 'Orientação', gaze: 'Olhar',
             head: 'Pescoço', anatomy: 'Anatomia', faces: 'Rostos'} as Record<string, string>)[key] ?? 'Orientação';
  }
  return ({header: 'Início', keep: 'Manter', participants: 'Pessoas', framing: 'Enquadramento', details: 'Detalhes',
           closing: 'Coerência', manual: 'Manual'} as Record<string, string>)[block] ?? block;
};

const LEVEL_LABEL = {error: 'Erro', warning: 'Aviso', adjusted: 'Ajustado', unknown: 'Não verificado'} as const;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
// A conflict between two fields is reported on each of them; the list and the verdict show it once.
const distinct = (issues: Issue[]) => issues.filter((issue, i) =>
  issues.findIndex(other => other.level === issue.level && other.message === issue.message) === i);

// One verdict from the rules: blocked by errors, ready with points to review, or ready.
function Verdict({prepared, pending}: {prepared: Prepared | null; pending: boolean}) {
  if (pending || !prepared) return <span className="badge">{pending ? 'Atualizando…' : '—'}</span>;
  const count = (level: string) => distinct(prepared.issues).filter(i => i.level === level).length;
  const [errors, warnings, adjusted, unknown] = ['error', 'warning', 'adjusted', 'unknown'].map(count);
  if (!prepared.valid) return <span className="badge incompatible">Incoerente · {plural(errors, 'erro', 'erros')}</span>;
  const notes = [warnings && plural(warnings, 'aviso', 'avisos'), adjusted && plural(adjusted, 'ajuste', 'ajustes'),
                 unknown && plural(unknown, 'não verificado', 'não verificados')].filter(Boolean);
  return <span className={'badge ' + (warnings ? 'undetermined' : 'compatible')}
               title="Resultado das regras de coerência entre os campos">
    {notes.length ? `Apto · ${notes.join(' · ')}` : 'Apto para gerar'}</span>;
}

export function PromptPreview({request, prepared, pending, error, onManual, onManualText, onFocusField}: Props) {
  const manual = request.prompt_mode === 'manual';
  const issues = distinct(prepared?.issues ?? []);
  const order = {error: 0, warning: 1, adjusted: 2, unknown: 3};
  return (
    <section className="card preview" aria-labelledby="prompt-title">
      <div className="section-title">
        <h2 id="prompt-title">Prompt enviado</h2>
        <Verdict prepared={prepared} pending={pending} />
      </div>
      <label className="check">
        <input type="checkbox" checked={manual} onChange={e => onManual(e.target.checked)} /> Editar o prompt manualmente
      </label>
      {manual ? (<>
        <textarea className="prompt-text" rows={14} value={request.manual_prompt ?? ''} spellCheck={false}
                  aria-label="Prompt manual" onChange={e => onManualText(e.target.value)} />
        <TranslateButton label="o prompt manual" text={request.manual_prompt ?? ''} onTranslated={onManualText} />
      </>) : (
        <div className="segments" aria-live="polite">
          {prepared?.segments.map(segment => (
            <p key={segment.block} className="segment"><span className="tag">{BLOCK_LABEL(segment.block)}</span>{segment.text}</p>
          ))}
          {!prepared?.segments.length && <p className="muted">{error || 'O prompt aparece aqui conforme você preenche.'}</p>}
        </div>
      )}
      <div className="row">
        <button className="quiet" disabled={!prepared?.prompt} onClick={() => navigator.clipboard.writeText(prepared?.prompt ?? '')}>Copiar</button>
        <span className="muted small">{prepared?.prompt ? `${prepared.prompt.length} caracteres` : ''}</span>
      </div>
      {error && <p className="issue error">{error}</p>}
      {issues.length > 0 && (
        <ul className="issues">
          {[...issues].sort((a, b) => order[a.level] - order[b.level]).map((issue, i) => (
            <li key={i} className={'issue ' + issue.level}>
              <button className="link" onClick={() => onFocusField(issue.field)}>
                <span className="level">{LEVEL_LABEL[issue.level]}</span>
                {issue.message}
              </button>
            </li>
          ))}
        </ul>
      )}
      <CoherenceReview request={request} prompt={prepared?.prompt ?? null} ready={!!prepared?.valid && !pending} />
    </section>
  );
}
