import {useCallback, useEffect, useState} from 'react';
import {api} from './api/client';
import type {Health, LibrarySnapshot, Stats} from './api/types';
import {Diagnostics, gigabytes, level} from './components/Diagnostics';
import {Characters} from './components/Characters';
import {Library} from './components/Library';
import {Icon} from './components/Icon';
import {Studio} from './components/Studio';
import {load, save} from './lib/storage';

type View = 'studio' | 'library' | 'characters' | 'diagnostics';
type Theme = 'system' | 'light' | 'dark';
const THEME_KEY = 'prisma.theme';
const NEXT_THEME: Record<Theme, Theme> = {system: 'light', light: 'dark', dark: 'system'};
const THEME_LABEL: Record<Theme, string> = {system: 'Tema do sistema', light: 'Tema claro', dark: 'Tema escuro'};

export function App() {
  const [view, setView] = useState<View>('studio');
  const [library, setLibrary] = useState<LibrarySnapshot | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [message, setMessage] = useState<{text: string; error: boolean} | null>(null);
  const [libraryDirty, setLibraryDirty] = useState(false);
  const [theme, setTheme] = useState<Theme>(load<Theme>(THEME_KEY, 'system'));

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') delete root.dataset.theme; else root.dataset.theme = theme;
    save(THEME_KEY, theme);
  }, [theme]);

  const notify = useCallback((text: string, error = false) => {
    setMessage({text, error});
    window.setTimeout(() => setMessage(current => current?.text === text ? null : current), error ? 9000 : 4000);
  }, []);
  const refreshHealth = useCallback(() => {
    api.health().then(setHealth).catch(() => setHealth(null));
    api.stats().then(setStats).catch(() => setStats(null));
  }, []);
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
  const device = stats?.comfy.devices?.[0];
  const vram = device?.vram_total && device.vram_free != null ? {used: device.vram_total - device.vram_free, total: device.vram_total} : null;
  const nav: [View, string][] = [['studio', 'Criar'], ['library', 'Biblioteca'], ['characters', 'Personagens'], ['diagnostics', 'Diagnóstico']];

  return (
    <div className={'app view-' + view}>
      <header className="topbar">
        <button className="brand" onClick={() => go('studio')} aria-label="Prisma Studio, início">
          <span className="logo" aria-hidden="true" /><span className="wordmark">Prisma</span>
        </button>
        <nav className="topnav" aria-label="Seções">
          {nav.map(([id, label]) => (
            <button key={id} aria-current={view === id ? 'page' : undefined} onClick={() => go(id)}>{label}</button>
          ))}
        </nav>
        <div className="topbar-end">
          {online && vram && <button className={'vram-chip ' + level(vram.used / vram.total)} onClick={() => go('diagnostics')}
            title="Memória de vídeo em uso na GPU (atualiza a cada 15 s)">
            VRAM <span className="num">{gigabytes(vram.used)}/{Math.round(vram.total / 1024 ** 3)} GB</span></button>}
          <button className={'engine-status ' + (online ? 'ok' : 'off')} onClick={() => go('diagnostics')}
                  title={health?.comfy_url}><span className="dot" />{online ? 'ComfyUI conectado' : 'ComfyUI offline'}</button>
          <button className="icon-btn" onClick={() => setTheme(NEXT_THEME[theme])} aria-label={THEME_LABEL[theme]} title={THEME_LABEL[theme]}>
            <Icon name={theme === 'light' ? 'sun' : theme === 'dark' ? 'moon' : 'monitor'} size={17} />
          </button>
        </div>
      </header>
      {message && <div className={'toast' + (message.error ? ' error' : '')} role="status">{message.text}
        <button className="toast-close" onClick={() => setMessage(null)} aria-label="Fechar"><Icon name="close" size={14} /></button></div>}
      <div className="app-body">
        {!library ? <p className="loading">Carregando…</p> :
          view === 'studio' ? <div className="page studio-page"><Studio library={library} comfyOnline={online} notify={notify} /></div> :
          <div className="page">{view === 'library'
            ? <Library snapshot={library} onSaved={setLibrary} notify={notify} setDirty={setLibraryDirty} />
            : view === 'characters' ? <Characters notify={notify} />
            : <Diagnostics health={health} refresh={refreshHealth} />}</div>}
      </div>
    </div>
  );
}
