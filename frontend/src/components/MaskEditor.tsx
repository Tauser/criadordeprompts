import {useEffect, useRef, useState} from 'react';
import {Segmented} from './Controls';
import {Icon} from './Icon';

interface Props {src: string; width: number; height: number; onSave: (mask: Blob) => void; onCancel: () => void}

const UNDO_LIMIT = 30;

// Paint the editable area over the target photo; the saved mask has the photo's exact size.
// Esc cancels, Enter uses the mask, Ctrl+Z undoes the last stroke.
export function MaskEditor({src, width, height, onSave, onCancel}: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const [brush, setBrush] = useState(Math.max(16, Math.round(Math.min(width, height) / 18)));
  const [tool, setTool] = useState<'brush' | 'eraser'>('brush');
  const [cursor, setCursor] = useState<{x: number; y: number; size: number} | null>(null);
  const [history, setHistory] = useState<ImageData[]>([]);
  const [empty, setEmpty] = useState(false);
  const drawing = useRef(false);
  const last = useRef<{x: number; y: number} | null>(null);
  const maxBrush = Math.max(8, Math.round(Math.min(width, height) / 4));

  useEffect(() => {
    const context = canvas.current?.getContext('2d');
    if (context) {context.clearRect(0, 0, width, height);}
  }, [width, height]);
  useEffect(() => {dialog.current?.focus();}, []);

  const context = () => canvas.current!.getContext('2d')!;
  const snapshot = () => setHistory(h => [...h.slice(-(UNDO_LIMIT - 1)), context().getImageData(0, 0, width, height)]);
  const undo = () => setHistory(h => {
    if (!h.length) return h;
    context().putImageData(h[h.length - 1], 0, 0);
    return h.slice(0, -1);
  });
  const clear = () => {snapshot(); context().clearRect(0, 0, width, height);};

  const point = (event: React.PointerEvent) => {
    const rect = canvas.current!.getBoundingClientRect();
    return {x: (event.clientX - rect.left) * width / rect.width, y: (event.clientY - rect.top) * height / rect.height};
  };
  const track = (event: React.PointerEvent) => {
    const rect = canvas.current!.getBoundingClientRect();
    setCursor({x: event.clientX - rect.left, y: event.clientY - rect.top, size: brush * rect.width / width});
  };
  const stroke = (event: React.PointerEvent) => {
    const ctx = context();
    const p = point(event);
    ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = 'rgba(255,64,96,1)';
    ctx.lineWidth = brush;
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.beginPath();
    const from = last.current ?? p;
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
  };
  const save = () => {
    const source = canvas.current!;
    const out = document.createElement('canvas');
    out.width = width; out.height = height;
    const ctx = out.getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
    const pixels = source.getContext('2d')!.getImageData(0, 0, width, height);
    const target = ctx.getImageData(0, 0, width, height);
    let painted = 0;
    for (let i = 0; i < pixels.data.length; i += 4) {
      if (pixels.data[i + 3] > 32) {target.data[i] = target.data[i + 1] = target.data[i + 2] = 255; painted++;}
    }
    if (!painted) {setEmpty(true); return;}
    ctx.putImageData(target, 0, 0);
    out.toBlob(blob => blob && onSave(blob), 'image/png');
  };
  const onKey = (event: React.KeyboardEvent) => {
    event.stopPropagation();
    if (event.key === 'Escape') {event.preventDefault(); onCancel();}
    else if (event.key === 'Enter' && !(event.target as HTMLElement).matches('button')) {event.preventDefault(); save();}
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {event.preventDefault(); undo();}
    else if (event.key === '[' || event.key === ']') setBrush(b => Math.max(4, Math.min(maxBrush, b + (event.key === ']' ? 4 : -4))));
  };

  return (
    <div className="mask-editor" role="dialog" aria-modal="true" aria-labelledby="mask-title" tabIndex={-1} ref={dialog} onKeyDown={onKey}>
      <header className="mask-head">
        <div>
          <h2 id="mask-title">Área que pode mudar</h2>
          <p>Pinte o que deve mudar. Fora da área pintada, a foto fica idêntica à original.</p>
        </div>
        <span className="spacer" />
        <button onClick={onCancel}>Cancelar <kbd>Esc</kbd></button>
        <button className="primary" onClick={save}>Usar máscara <kbd>↵</kbd></button>
      </header>
      <div className="mask-stage" style={{aspectRatio: `${width} / ${height}`}}>
        <img src={src} alt="Foto alvo" draggable={false} />
        <canvas ref={canvas} width={width} height={height}
                onPointerDown={e => {snapshot(); setEmpty(false); drawing.current = true; last.current = null; (e.target as Element).setPointerCapture(e.pointerId); stroke(e);}}
                onPointerMove={e => {track(e); if (drawing.current) stroke(e);}}
                onPointerUp={() => {drawing.current = false; last.current = null;}}
                onPointerLeave={() => setCursor(null)} />
        {cursor && <span className="brush-cursor" aria-hidden="true"
                         style={{left: cursor.x, top: cursor.y, width: cursor.size, height: cursor.size}} />}
      </div>
      <div className="mask-tools" role="toolbar" aria-label="Ferramentas da máscara">
        <Segmented label="Ferramenta" value={tool} onChange={setTool}
          options={[{value: 'brush', label: <><Icon name="brush" size={15} />Pincel</>},
                    {value: 'eraser', label: <><Icon name="eraser" size={15} />Borracha</>}]} />
        <label className="brush-size">Tamanho
          <input type="range" min={4} max={maxBrush} value={brush} onChange={e => setBrush(Number(e.target.value))} />
          <span className="num">{brush} px</span></label>
        <button onClick={undo} disabled={!history.length} title="Desfazer (Ctrl+Z)"><Icon name="undo" size={15} />Desfazer</button>
        <button onClick={clear}>Limpar</button>
        {empty && <span className="mask-warning" role="alert">Pinte a área que deve mudar antes de usar a máscara.</span>}
      </div>
    </div>
  );
}
