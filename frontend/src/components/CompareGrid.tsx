import {useEffect, useState} from 'react';
import {api, fileUrl} from '../api/client';
import type {Category, Item, Run, StudioRequest} from '../api/types';
import {CATEGORY_LABELS, RUN_STATUS, TERMINAL} from '../lib/labels';
import {uuid} from '../lib/uuid';
import {Segmented} from './Controls';

// One axis per grid: new seeds, the two quality profiles, or library options of one category (same seed).
export type ComparePlan = {axis: 'seeds'} | {axis: 'profile'} | {axis: 'option'; category: Category; itemIds: string[]};
// A generation of the grid: the run once it was accepted by the Studio, or the reason it was not.
export interface GridCell {label: string; runId?: string; error?: string}

const OPTION_LIMITS = [2, 4] as const;
const SEEDS = 4;

interface Planned {label: string; request: StudioRequest}

// Each cell is the run's own request with one change; a single variation, so the grid compares one picture per cell.
export function plannedCells(run: Run, plan: ComparePlan, items: Item[]): Planned[] {
  const base = run.request!;
  const variant = (change: (r: StudioRequest) => void): StudioRequest => {
    const request = structuredClone(base);
    request.output.variations = 1;
    change(request);
    return request;
  };
  if (plan.axis === 'seeds') return Array.from({length: SEEDS}, () => {
    const seed = Math.floor(Math.random() * 2 ** 32);
    return {label: `seed ${seed}`, request: variant(r => {r.output.seed = seed;})};
  });
  const seed = run.settings.seed;
  if (plan.axis === 'profile') return (['turbo', 'qwen21'] as const).map(profile => ({
    label: profile === 'turbo' ? 'Turbo' : 'Completo',
    request: variant(r => {
      r.output.seed = seed; r.output.profile = profile;
      if (profile === 'turbo') r.output.refine = false;
    }),
  }));
  return plan.itemIds.map(id => ({
    label: items.find(item => item.id === id)?.label ?? id,
    request: variant(r => {
      r.output.seed = seed;
      r.attributes[plan.category] = {intent: 'set', value: {kind: 'catalog', item_id: id}};
    }),
  }));
}

// Sends one request per cell, in order. A refused cell keeps its error and does not stop the others.
export async function startComparison(run: Run, plan: ComparePlan, items: Item[],
                                      onProgress?: (cells: GridCell[]) => void): Promise<GridCell[]> {
  const cells: GridCell[] = [];
  for (const planned of plannedCells(run, plan, items)) {
    try {
      const created = await api.createRun({request_id: uuid(), request: planned.request,
        files: run.files?.references ?? {}, mask: run.files?.mask ?? null});
      cells.push({label: planned.label, runId: created.id});
    } catch (error) {
      cells.push({label: planned.label, error: (error as Error).message});
    }
    onProgress?.([...cells]);
  }
  return cells;
}

// The choice of the axis, shown inline under the actions of the result.
export function ComparePicker({run, items, busy, onConfirm, onCancel}: {run: Run; items: Item[]; busy: boolean;
  onConfirm: (plan: ComparePlan) => void; onCancel: () => void}) {
  const adult = run.request?.content_mode === 'adult';
  const categories = (Object.keys(run.request?.attributes ?? {}) as Category[])
    .filter(c => run.request?.attributes[c]?.intent === 'set' && run.request?.attributes[c]?.value?.kind === 'catalog');
  const [axis, setAxis] = useState<'seeds' | 'profile' | 'option'>('seeds');
  const [category, setCategory] = useState<Category | null>(categories[0] ?? null);
  const [picked, setPicked] = useState<string[]>([]);
  const options = category ? items.filter(i => i.category === category && i.enabled && (adult || !i.adult)) : [];
  const [min, max] = OPTION_LIMITS;
  const valid = axis !== 'option' || (!!category && picked.length >= min && picked.length <= max);
  const count = axis === 'seeds' ? SEEDS : axis === 'profile' ? 2 : picked.length;
  const confirm = () => {
    if (axis === 'option') {if (category) onConfirm({axis, category, itemIds: picked});}
    else onConfirm({axis});
  };

  return (
    <div className="compare-picker" role="group" aria-label="Comparar">
      <Segmented small label="Eixo da comparação" value={axis} onChange={setAxis} options={[
        {value: 'seeds', label: 'Seeds', title: 'Quatro seeds novas, com o mesmo pedido'},
        {value: 'profile', label: 'Perfil', title: 'A mesma seed no Turbo e no Completo'},
        {value: 'option', label: 'Opção', disabled: !categories.length,
          title: categories.length ? 'Troca uma categoria por opções da biblioteca, na mesma seed'
            : 'Nenhuma categoria deste pedido tem opção da biblioteca'},
      ]} />
      {axis === 'option' && category && <>
        <label>Categoria
          <select value={category} onChange={e => {setCategory(e.target.value as Category); setPicked([]);}}>
            {categories.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
          </select></label>
        <div className="checks" role="group" aria-label="Opções">
          {options.map(item => (
            <label key={item.id} className="check">
              <input type="checkbox" checked={picked.includes(item.id)} disabled={!picked.includes(item.id) && picked.length >= max}
                     onChange={e => setPicked(p => e.target.checked ? [...p, item.id] : p.filter(x => x !== item.id))} />
              {item.label}</label>))}
        </div>
        {!options.length && <p className="muted small">Nenhuma opção ativa nesta categoria.</p>}
        {picked.length < min && <p className="issue warning">Escolha de {min} a {max} opções.</p>}
      </>}
      <div className="row">
        <button className="primary" disabled={!valid || busy} onClick={confirm}>
          Gerar grade ({count} gerações)</button>
        <button className="quiet" onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  );
}

// The grid: one cell per generation, polled every 2 s until each run ends. Its cells live in the Studio's storage.
export function CompareGrid({cells, onClose}: {cells: GridCell[]; onClose: () => void}) {
  const [runs, setRuns] = useState<Record<string, Run>>({});
  const idsKey = cells.map(c => c.runId).filter(Boolean).join(',');
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
    <section className="card compare-grid" aria-labelledby="compare-title">
      <div className="section-title">
        <h2 id="compare-title">Grade de comparação</h2>
        <span className="spacer" />
        <button className="quiet" onClick={onClose}>Fechar grade</button>
      </div>
      <div className="compare-cells">
        {cells.map((cell, index) => <CompareCell key={index} cell={cell} run={cell.runId ? runs[cell.runId] : undefined} />)}
      </div>
    </section>
  );
}

function CompareCell({cell, run}: {cell: GridCell; run?: Run}) {
  if (cell.error) return (
    <figure className="compare-cell">
      <div className="compare-image"><div className="compare-placeholder"><span>Não enviada</span></div></div>
      <figcaption><strong>{cell.label}</strong></figcaption>
      <p className="issue error">{cell.error}</p>
    </figure>
  );
  const image = run?.images.find(i => i.files.length)?.files[0];
  const failed = !!run && ['failed', 'cancelled', 'lost'].includes(run.status);
  return (
    <figure className="compare-cell">
      <div className="compare-image">
        {image ? (
          <a href={fileUrl(image)} target="_blank" rel="noreferrer" title="Abrir em tamanho real">
            <img src={fileUrl(image)} alt={`Resultado: ${cell.label}`} /></a>
        ) : (
          <div className="compare-placeholder"><span>{run ? RUN_STATUS[run.status] ?? run.status : 'Na fila do Studio'}</span></div>
        )}
      </div>
      <figcaption><strong>{cell.label}</strong>
        {run && run.status === 'completed' && !image && <span className="muted small"> · sem imagem</span>}</figcaption>
      {failed && run?.error && <p className="issue error">{run.error}</p>}
    </figure>
  );
}
