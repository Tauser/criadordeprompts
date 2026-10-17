import {useCallback, useEffect, useState} from 'react';
import {api} from './api/client';
import type {Health, LibrarySnapshot} from './api/types';
import {Diagnostics} from './components/Diagnostics';
import {Library} from './components/Library';
import {Icon} from './components/Icon';
import {Studio} from './components/Studio';

type View = 'studio' | 'library' | 'diagnostics';

export function App() {
  const [view, setView] = useState<View>('studio');
  const [library, setLibrary] = useState<LibrarySnapshot | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [message, setMessage] = useState<{text: string; error: boolean} | null>(null);
  const [libraryDirty, setLibraryDirty] = useState(false);

  const notify = useCallback((text: string, error = false) => {
    setMessage({text, error});
    window.setTimeout(() => setMessage(current => current?.text === text ? null : current), error ? 9000 : 4000);
  }, []);
  const refreshHealth = useCallback(() => {api.health().then(setHealth).catch(() => setHealth(null));}, []);
  useEffect(() => {
    api.library().then(setLibrary).catch(error => notify((error as Error).message, true));
    refreshHealth();
    const timer = window.setInterval(refreshHealth, 15000);
    return () => window.clearInterval(timer);
  }, [notify, refreshHealth]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {if (libraryDirty) {event.preventDefault(); event.returnValue = '';}};
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [libraryDirty]);
  const go = (next: View) => {
    if (view === 'library' && libraryDirty && !confirm('Descartar as alterações não salvas da biblioteca?')) return;
    setView(next);
  };
  const online = !!health?.comfy.available;

  return (
    <div className="app">
      <header className="app-header">
        <button className="brand" onClick={() => go('studio')}><span className="logo" aria-hidden="true" />Prisma <span>Studio</span></button>
        <nav aria-label="Seções">
          <button className={view === 'studio' ? 'active' : ''} onClick={() => go('studio')}><Icon name="image" size={14} /> Estúdio</button>
          <button className={view === 'library' ? 'active' : ''} onClick={() => go('library')}><Icon name="library" size={14} /> Biblioteca</button>
          <button className={view === 'diagnostics' ? 'active' : ''} onClick={() => go('diagnostics')}><Icon name="pulse" size={14} /> Diagnóstico</button>
        </nav>
        <span className={'status ' + (online ? 'ok' : 'off')} title={health?.comfy_url}>{online ? '● ComfyUI conectado' : '○ ComfyUI offline'}</span>
      </header>
      {message && <div className={'toast' + (message.error ? ' error' : '')} role="status">{message.text}
        <button className="link" onClick={() => setMessage(null)} aria-label="Fechar">×</button></div>}
      <div className={"app-body" + (view === "studio" ? " full" : "")}>
        {!library ? <p className="card">Carregando…</p> :
          view === 'studio' ? <Studio library={library} comfyOnline={online} notify={notify} /> :
          view === 'library' ? <Library snapshot={library} onSaved={setLibrary} notify={notify} setDirty={setLibraryDirty} /> :
          <Diagnostics health={health} refresh={refreshHealth} />}
      </div>
    </div>
  );
}
