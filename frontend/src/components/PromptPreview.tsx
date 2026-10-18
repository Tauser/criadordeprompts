import type {Prepared, StudioRequest} from '../api/types';
import {CATEGORY_LABELS} from '../lib/labels';
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
  if (block.startsWith('guide.')) return 'Orientação';
  return ({header: 'Início', keep: 'Manter', participants: 'Pessoas', framing: 'Enquadramento', details: 'Detalhes',
           closing: 'Coerência', manual: 'Manual'} as Record<string, string>)[block] ?? block;
};

export function PromptPreview({request, prepared, pending, error, onManual, onManualText, onFocusField}: Props) {
  const manual = request.prompt_mode === 'manual';
  const issues = prepared?.issues ?? [];
  const order = {error: 0, warning: 1, unknown: 2};
  return (
    <section className="card preview" aria-labelledby="prompt-title">
      <div className="section-title">
        <h2 id="prompt-title">Prompt enviado</h2>
        <span className={'badge ' + (prepared ? (prepared.valid ? prepared.status : 'incompatible') : '')}>
          {pending ? 'Atualizando…' : !prepared ? '—' : !prepared.valid ? 'Corrija os erros' :
            prepared.status === 'compatible' ? 'Pronto' : 'Pronto · revise os avisos'}
        </span>
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
                <span className="level">{issue.level === 'error' ? 'Erro' : issue.level === 'warning' ? 'Aviso' : 'Não verificado'}</span>
                {issue.message}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
