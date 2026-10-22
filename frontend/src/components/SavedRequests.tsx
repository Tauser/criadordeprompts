import {useEffect, useState} from 'react';
import {api} from '../api/client';
import type {SavedRequest, StudioRequest} from '../api/types';
import {Tip} from './Controls';

const NAME_MAX = 80;

interface Props {
  current: () => StudioRequest;                        // the request as it would be sent, without photos
  onLoad: (request: StudioRequest) => void;
  notify: (message: string, error?: boolean) => void;
}

// "Pedidos salvos": named templates of the form's choices. Photos never go into a template; see the backend's presets.
export function SavedRequests({current, onLoad, notify}: Props) {
  const [presets, setPresets] = useState<SavedRequest[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [mode, setMode] = useState<'idle' | 'saving' | 'renaming'>('idle');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selected = presets?.find(p => p.id === selectedId) ?? null;

  useEffect(() => {
    let stopped = false;
    api.presets()
      .then(result => {if (!stopped) setPresets(result.presets);})
      .catch(() => {if (!stopped) setFailed(true);});
    return () => {stopped = true;};
  }, []);

  const open = (next: 'saving' | 'renaming') => {
    setMode(next); setError(null);
    setName(next === 'renaming' && selected ? selected.name : '');
  };
  const close = () => {setMode('idle'); setName(''); setError(null);};

  const submitName = async () => {
    const trimmed = name.trim();
    if (!trimmed) {setError('Dê um nome ao pedido.'); return;}
    if (trimmed.length > NAME_MAX) {setError(`Use até ${NAME_MAX} caracteres.`); return;}
    setBusy(true);
    try {
      if (mode === 'saving') {
        const saved = await api.createPreset(trimmed, current());
        setPresets(list => [saved, ...(list ?? [])]);
        setSelectedId(saved.id);
        notify(`Pedido “${saved.name}” salvo.`);
      } else if (selected) {
        const renamed = await api.renamePreset(selected.id, trimmed);
        setPresets(list => (list ?? []).map(p => p.id === renamed.id ? renamed : p));
        notify(`Pedido renomeado para “${renamed.name}”.`);
      }
      close();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const load = () => {
    if (!selected) return;
    onLoad(selected.request);
    notify(`Pedido “${selected.name}” carregado. Revise os campos antes de gerar.`);
  };

  const remove = async () => {
    if (!selected || !confirm(`Apagar o pedido “${selected.name}”? Esta ação não pode ser desfeita.`)) return;
    setBusy(true);
    try {
      await api.deletePreset(selected.id);
      setPresets(list => (list ?? []).filter(p => p.id !== selected.id));
      setSelectedId('');
      close();
      notify('Pedido apagado.');
    } catch (failure) {
      notify((failure as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card saved-requests" aria-labelledby="saved-title">
      <div className="section-title">
        <h2 id="saved-title">Pedidos salvos</h2>
        <Tip>Guarda as escolhas do formulário com um nome. Fotos, seed e confirmações de conteúdo não entram: ao carregar,
          as fotos atuais continuam anexadas.</Tip>
      </div>
      <div className="saved-row">
        <select aria-label="Pedido salvo" value={selectedId} disabled={!presets?.length || busy}
                onChange={e => {setSelectedId(e.target.value); close();}}>
          <option value="">{presets === null ? (failed ? 'Indisponível' : 'Carregando…') : presets.length ? 'Escolha um pedido' : 'Nenhum pedido salvo'}</option>
          {presets?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button type="button" className="quiet" disabled={!selected || busy} onClick={load}
                title="Substitui as escolhas do formulário pelas do pedido">Carregar</button>
        <button type="button" className="quiet" disabled={busy} onClick={() => open('saving')}
                title="Salva as escolhas atuais do formulário como um novo pedido">Salvar pedido</button>
      </div>
      {mode !== 'idle' && (
        <form className="saved-form" onSubmit={e => {e.preventDefault(); void submitName();}}>
          <label>{mode === 'saving' ? 'Nome do pedido' : 'Novo nome'}
            <input autoFocus maxLength={NAME_MAX} value={name} placeholder="Ex.: Cena noturna na rua, 2 pessoas"
                   onChange={e => {setName(e.target.value); setError(null);}}
                   onKeyDown={e => {if (e.key === 'Escape') {e.stopPropagation(); close();}}} />
          </label>
          <button type="submit" className="quiet" disabled={busy}>{mode === 'saving' ? 'Salvar' : 'Renomear'}</button>
          <button type="button" className="quiet" disabled={busy} onClick={close}>Cancelar</button>
          {error && <ul className="field-issues"><li>{error}</li></ul>}
        </form>
      )}
      {selected && mode === 'idle' && (
        <div className="saved-actions">
          <button type="button" className="quiet" disabled={busy} onClick={() => open('renaming')}>Renomear</button>
          <button type="button" className="quiet stop" disabled={busy} onClick={remove}>Apagar</button>
        </div>
      )}
      {failed && <p className="help">Não foi possível carregar os pedidos salvos. Atualize a página para tentar de novo.</p>}
    </section>
  );
}
