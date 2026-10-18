import type {Health} from '../api/types';

export function Diagnostics({health, refresh}: {health: Health | null; refresh: () => void}) {
  return (
    <section className="diagnostics">
      <header className="page-head"><div><h1>Diagnóstico</h1><p className="muted">Estado do Studio e da conexão com o ComfyUI.</p></div>
        <button className="quiet" onClick={refresh}>Atualizar</button></header>
      <div className="card">
      {!health ? <p className="muted">Carregando…</p> : (
        <dl>
          <dt>Versão do Studio</dt><dd>{health.studio_version}</dd>
          <dt>Diretório de dados</dt><dd><code>{health.data_dir}</code></dd>
          <dt>ComfyUI</dt><dd><code>{health.comfy_url}</code> · {health.comfy.available ? `conectado (versão ${health.comfy.version ?? '?'})` : 'offline'}</dd>
          {health.comfy.devices?.length ? <><dt>GPU</dt><dd>{health.comfy.devices.join(', ')}</dd></> : null}
          <dt>Progresso em tempo real</dt><dd>{health.progress_live ? 'ativo' : 'indisponível (o status continua pelo /api/jobs)'}</dd>
          <dt>Acesso pela rede</dt><dd>{health.network_access?.mode === 'lan'
            ? `rede local sem senha · ${health.network_access.allowed_networks.join(', ')}`
            : health.lan_token ? 'habilitado com token' : 'somente este computador'}</dd>
          {health.network_access?.urls.length ? <><dt>Endereço na rede local</dt><dd>
            {health.network_access.urls.map(url => <div key={url}><a href={url}>{url}</a></div>)}
          </dd></> : null}
        </dl>
      )}
      </div>
    </section>
  );
}
