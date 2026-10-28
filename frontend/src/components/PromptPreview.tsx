import type {Issue, Prepared, StudioRequest} from '../api/types';
import {CATEGORY_LABELS} from '../lib/labels';
import {useCollapsed} from '../lib/useCollapsed';
import {CoherenceReview} from './CoherenceReview';
import {CollapseButton} from './Collapse';
import {Icon} from './Icon';
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
             head: 'Pescoço', anatomy: 'Anatomia', faces: 'Rostos', bodies: 'Corpos'} as Record<string, string>)[key] ?? 'Orientação';
  }
  return ({header: 'Início', sexes: 'Quem é quem', keep: 'Manter', participants: 'Pessoas', framing: 'Enquadramento',
           details: 'Detalhes', closing: 'Coerência', manual: 'Manual'} as Record<string, string>)[block] ?? block;
};

// Issues that only mean "not filled in yet": shown as steps to take, not as errors.
export const SETUP_STEPS: Record<string, string> = {
  missing_target: 'Adicione a foto alvo',
  missing_change: 'Escolha pelo menos um campo para mudar',
};
export const setupIssues = (issues: Issue[]) => issues.filter(i => i.level === 'error' && i.code in SETUP_STEPS);

const LEVEL_LABEL = {error: 'Erro', warning: 'Aviso', adjusted: 'Ajustado', unknown: 'Não verificado'} as const;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
// A conflict between two fields is reported on each of them; the list and the verdict show it once.
const distinct = (issues: Issue[]) => issues.filter((issue, i) =>
  issues.findIndex(other => other.level === issue.level && other.message === issue.message) === i);

// One verdict from the rules: steps still missing, blocked by conflicts, ready with points to review, or ready.
function Verdict({prepared, pending}: {prepared: Prepared | null; pending: boolean}) {
  if (pending || !prepared) return <span className="badge">{pending ? 'Atualizando…' : '—'}</span>;
  const issues = distinct(prepared.issues);
  const count = (level: string) => issues.filter(i => i.level === level).length;
  const [warnings, adjusted, unknown] = ['warning', 'adjusted', 'unknown'].map(count);
  const setup = setupIssues(issues).length;
  const errors = count('error') - setup;
  if (!prepared.valid) return errors
    ? <span className="badge incompatible">{plural(errors, 'conflito', 'conflitos')}</span>
    : <span className="badge">{setup === 1 ? 'Falta 1 passo' : `Faltam ${setup} passos`}</span>;
  const notes = [warnings && plural(warnings, 'aviso', 'avisos'), adjusted && plural(adjusted, 'ajuste', 'ajustes'),
                 unknown && plural(unknown, 'não verificado', 'não verificados')].filter(Boolean);
  return <span className={'badge ' + (warnings ? 'undetermined' : 'compatible')}
               title="Resultado das regras de coerência entre os campos">
    {notes.length ? `Pronto · ${notes.join(' · ')}` : 'Pronto para gerar'}</span>;
}

export function PromptPreview({request, prepared, pending, error, onManual, onManualText, onFocusField}: Props) {
  const [collapsed, toggle] = useCollapsed('prompt');
  const manual = request.prompt_mode === 'manual';
  const issues = distinct(prepared?.issues ?? []).filter(i => !(i.level === 'error' && i.code in SETUP_STEPS));
  const missing = new Set(setupIssues(prepared?.issues ?? []).map(i => i.code));
  const steps = request.mode === 'edit' && missing.size ? Object.entries(SETUP_STEPS) : [];
  const order = {error: 0, warning: 1, adjusted: 2, unknown: 3};
  return (
    <section className={'card preview collapsible' + (collapsed ? ' is-collapsed' : '')} aria-labelledby="prompt-title">
      <div className="section-title">
        <h2 id="prompt-title">Prompt</h2>
        <span className="spacer" />
        <Verdict prepared={prepared} pending={pending} />
        <CollapseButton collapsed={collapsed} onToggle={toggle} controls="prompt-body" label="prompt" />
      </div>
      {!collapsed && <div id="prompt-body" className="preview-body">
      {steps.length > 0 && (
        <ol className="setup-steps" aria-label="Para começar">
          {steps.map(([code, text], i) => (
            <li key={code} className={missing.has(code) ? '' : 'done'}>
              <span className="step-n" aria-hidden="true">{missing.has(code) ? i + 1 : <Icon name="check" size={11} />}</span>
              <button className="link" disabled={!missing.has(code)} onClick={() => onFocusField(code === 'missing_target' ? 'target_id' : 'attributes')}>{text}</button>
              {!missing.has(code) && <span className="sr-only"> (feito)</span>}
            </li>
          ))}
        </ol>
      )}
      {manual ? (<>
        <textarea className="prompt-text" rows={14} value={request.manual_prompt ?? ''} spellCheck={false}
                  aria-label="Prompt manual" onChange={e => onManualText(e.target.value)} />
        <TranslateButton label="o prompt manual" text={request.manual_prompt ?? ''} onTranslated={onManualText} />
      </>) : !steps.length && (
        <div className="segments" aria-live="polite">
          {prepared?.segments.map(segment => (
            <p key={segment.block} className="segment"><span className="tag">{BLOCK_LABEL(segment.block)}</span>{segment.text}</p>
          ))}
          {!prepared?.segments.length && <p className="muted">{error || 'O prompt aparece aqui conforme você preenche.'}</p>}
        </div>
      )}
      {error && <p className="issue error">{error}</p>}
      {issues.length > 0 && (
        <ul className="issues">
          {[...issues].sort((a, b) => order[a.level] - order[b.level]).map((issue, i) => (
            <li key={i} className={'issue ' + issue.level}>
              <button className="link" onClick={() => onFocusField(issue.field)}>
                <span className="level">{issue.level === 'error' ? 'Conflito' : LEVEL_LABEL[issue.level]}</span>
                {issue.message}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="row preview-tools">
        <button className="quiet" disabled={!prepared?.prompt} onClick={() => navigator.clipboard.writeText(prepared?.prompt ?? '')}>Copiar</button>
        <label className="check"><input type="checkbox" checked={manual} onChange={e => onManual(e.target.checked)} /> Editar manualmente</label>
        <span className="spacer" />
        <span className="muted small num">{prepared?.prompt ? `${prepared.prompt.length} caracteres` : ''}</span>
      </div>
      <CoherenceReview request={request} prompt={prepared?.prompt ?? null} ready={!!prepared?.valid && !pending} />
      </div>}
    </section>
  );
}
