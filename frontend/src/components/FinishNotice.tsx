import type {useFinishNotice} from '../lib/finishNotice';

// Settings for the "finished" notice, kept in the Studio header row.
export function FinishNotice({finish}: {finish: ReturnType<typeof useFinishNotice>}) {
  return (
    <div className="finish-notice">
      <span className="muted small">Avisar quando terminar</span>
      <div className="checks">
        <label className="check" title="Mostra uma notificação do sistema quando a aba estiver em segundo plano.">
          <input type="checkbox" checked={finish.system} disabled={finish.reason !== null}
                 onChange={e => void finish.setSystem(e.target.checked)} /> Notificação do sistema</label>
        {finish.reason && <p className="help" role="status">{finish.reason}</p>}
        <label className="check" title="Um bipe curto ao terminar.">
          <input type="checkbox" checked={finish.sound} onChange={e => finish.setSound(e.target.checked)} /> Som</label>
      </div>
    </div>
  );
}
