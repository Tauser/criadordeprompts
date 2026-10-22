import {useEffect, useRef, useState} from 'react';
import {api, fileUrl} from '../api/client';
import type {Run} from '../api/types';
import {CHARACTER_PHOTOS_MAX, SHEET_VIEWS, sheetRequest} from '../lib/characters';
import {RUN_STATUS, TERMINAL} from '../lib/labels';
import {uuid} from '../lib/uuid';

// One run per view, in SHEET_VIEWS order: the run's id, or the reason the Studio refused it.
interface Cell {runId?: string; error?: string}
interface Props {name: string; mainPhoto: string; photos: string[]; onAdd: (hash: string) => Promise<void>}

// "Folha de referência": the person from the main photo in four views. Each finished view can be added to the ficha.
export function ReferenceSheet({name, mainPhoto, photos, onAdd}: Props) {
  const [cells, setCells] = useState<Cell[] | null>(null);
  const [runs, setRuns] = useState<Record<string, Run>>({});
  const [generating, setGenerating] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {alive.current = false;};
  }, []);

  // Polled every 2 s until each run ends, as in the comparison grid. Leaving the screen stops it.
  const idsKey = (cells ?? []).map(cell => cell.runId).filter(Boolean).join(',');
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

  const generate = async () => {
    setGenerating(true);
    setCells([]);
    setRuns({});
    setAddError(null);
    const made: Cell[] = [];
    for (const view of SHEET_VIEWS) {
      try {
        const run = await api.createRun({request_id: uuid(), request: sheetRequest(view.text, name), files: {p: mainPhoto}, mask: null});
        made.push({runId: run.id});
      } catch (failure) {
        made.push({error: (failure as Error).message});
      }
      if (!alive.current) return;
      setCells([...made]);
    }
    setGenerating(false);
  };

  const add = async (hash: string) => {
    setAdding(hash);
    setAddError(null);
    try {
      await onAdd(hash);
    } catch (failure) {
      setAddError((failure as Error).message);
    } finally {
      setAdding(null);
    }
  };

  const full = photos.length >= CHARACTER_PHOTOS_MAX;

  return (
    <div className="reference-sheet">
      <div className="character-photos-head">
        <strong>Folha de referência</strong>
        <span className="spacer" />
        <button type="button" className="secondary small" disabled={generating} onClick={generate}
                title="Gera a pessoa de frente, de três quartos, de perfil e em retrato, em fundo neutro, a partir da foto principal. Escolha as que ficarem parecidas e adicione à ficha.">
          Gerar folha de referência
        </button>
      </div>
      {cells && <>
        <div className="compare-cells">
          {SHEET_VIEWS.map((view, index) => {
            const cell = cells[index];
            return (
              <SheetCell key={view.label} label={view.label} cell={cell} run={cell?.runId ? runs[cell.runId] : undefined}
                         photos={photos} full={full} busy={adding !== null} adding={adding} onAdd={add} />
            );
          })}
        </div>
        <p className="muted small">Confira o rosto antes de adicionar: só entram as vistas parecidas com a pessoa.</p>
        {addError && <p className="issue error">{addError}</p>}
      </>}
    </div>
  );
}

function SheetCell({label, cell, run, photos, full, busy, adding, onAdd}: {label: string; cell?: Cell; run?: Run;
  photos: string[]; full: boolean; busy: boolean; adding: string | null; onAdd: (hash: string) => void}) {
  const hash = run?.images[0]?.files[0];
  const added = !!hash && photos.includes(hash);
  const failed = !!run && ['failed', 'cancelled', 'lost'].includes(run.status);
  return (
    <figure className="compare-cell">
      <div className="compare-image">
        {hash ? (
          <a href={fileUrl(hash)} target="_blank" rel="noreferrer" title="Abrir em tamanho real">
            <img src={fileUrl(hash)} alt={`Vista: ${label}`} /></a>
        ) : (
          <div className="compare-placeholder"><span>{cell?.error ? 'Não enviada'
            : run ? RUN_STATUS[run.status] ?? run.status : cell ? 'Na fila do Studio' : 'Aguardando'}</span></div>
        )}
      </div>
      <figcaption><strong>{label}</strong>
        {run?.status === 'completed' && !hash && <span className="muted small"> · sem imagem</span>}</figcaption>
      {cell?.error && <p className="issue error">{cell.error}</p>}
      {failed && run?.error && <p className="issue error">{run.error}</p>}
      {hash && <>
        <button type="button" className="secondary small" disabled={added || full || busy}
                onClick={() => onAdd(hash)}>
          {added ? 'Adicionada' : adding === hash ? 'Adicionando…' : 'Adicionar à ficha'}
        </button>
        {full && !added && <p className="muted small">A ficha já tem {CHARACTER_PHOTOS_MAX} fotos. Remova uma para adicionar.</p>}
      </>}
    </figure>
  );
}
