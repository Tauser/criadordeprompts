import {useEffect, useRef, useState} from 'react';

interface Props {src: string; width: number; height: number; onSave: (mask: Blob) => void; onCancel: () => void}

// Paint the editable area in white over the target photo; the saved mask has the photo's exact size.
export function MaskEditor({src, width, height, onSave, onCancel}: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [brush, setBrush] = useState(Math.max(16, Math.round(Math.min(width, height) / 18)));
  const [erase, setErase] = useState(false);
  const drawing = useRef(false);
  const last = useRef<{x: number; y: number} | null>(null);

  useEffect(() => {
    const context = canvas.current?.getContext('2d');
    if (context) {context.clearRect(0, 0, width, height);}
  }, [width, height]);

  const point = (event: React.PointerEvent) => {
    const rect = canvas.current!.getBoundingClientRect();
    return {x: (event.clientX - rect.left) * width / rect.width, y: (event.clientY - rect.top) * height / rect.height};
  };
  const stroke = (event: React.PointerEvent) => {
    const context = canvas.current!.getContext('2d')!;
    const p = point(event);
    context.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
    context.strokeStyle = 'rgba(255,64,96,1)';
    context.lineWidth = brush;
    context.lineCap = context.lineJoin = 'round';
    context.beginPath();
    const from = last.current ?? p;
    context.moveTo(from.x, from.y);
    context.lineTo(p.x, p.y);
    context.stroke();
    last.current = p;
  };
  const save = () => {
    const source = canvas.current!;
    const out = document.createElement('canvas');
    out.width = width; out.height = height;
    const context = out.getContext('2d')!;
    context.fillStyle = '#000';
    context.fillRect(0, 0, width, height);
    const pixels = source.getContext('2d')!.getImageData(0, 0, width, height);
    const target = context.getImageData(0, 0, width, height);
    let painted = 0;
    for (let i = 0; i < pixels.data.length; i += 4) {
      if (pixels.data[i + 3] > 32) {target.data[i] = target.data[i + 1] = target.data[i + 2] = 255; painted++;}
    }
    if (!painted) {alert('Pinte a área que deve mudar.'); return;}
    context.putImageData(target, 0, 0);
    out.toBlob(blob => blob && onSave(blob), 'image/png');
  };
  return (
    <div className="mask-editor" role="dialog" aria-label="Máscara da edição">
      <p className="help">Pinte a área que pode mudar. Fora dela, a foto fica idêntica à original.</p>
      <div className="mask-stage" style={{aspectRatio: `${width} / ${height}`}}>
        <img src={src} alt="Foto alvo" draggable={false} />
        <canvas ref={canvas} width={width} height={height}
                onPointerDown={e => {drawing.current = true; last.current = null; (e.target as Element).setPointerCapture(e.pointerId); stroke(e);}}
                onPointerMove={e => drawing.current && stroke(e)}
                onPointerUp={() => {drawing.current = false; last.current = null;}} />
      </div>
      <div className="row">
        <label>Pincel <input type="range" min={4} max={Math.round(Math.min(width, height) / 4)} value={brush}
                              onChange={e => setBrush(Number(e.target.value))} /></label>
        <label className="check"><input type="checkbox" checked={erase} onChange={e => setErase(e.target.checked)} /> Borracha</label>
        <button className="quiet" onClick={() => canvas.current!.getContext('2d')!.clearRect(0, 0, width, height)}>Limpar</button>
        <span className="spacer" />
        <button className="quiet" onClick={onCancel}>Cancelar</button>
        <button className="primary" onClick={save}>Usar máscara</button>
      </div>
    </div>
  );
}
