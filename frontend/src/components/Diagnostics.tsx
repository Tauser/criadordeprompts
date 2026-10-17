import type {Health} from '../api/types';

export function Diagnostics({health, refresh}: {health: Health | null; refresh: () => void}) {
  return (
    <section className="card diagnostics">
      <h2>Diagnóstico</h2>
      {!health ? <p className="muted">Carregando…</p> : (
        <dl>
          <dt>Versão do Studio</dt><dd>{health.studio_version}</dd>
          <dt>Diretório de dados</dt><dd><code>{health.data_dir}</code></dd>
          <dt>ComfyUI</dt><dd><code>{health.comfy_url}</code> · {health.comfy.available ? `conectado (versão ${health.comfy.version ?? '?'})` : 'offline'}</dd>
          {health.comfy.devices?.length ? <><dt>GPU</dt><dd>{health.comfy.devices.join(', ')}</dd></> : null}
          <dt>Progresso em tempo real</dt><dd>{health.progress_live ? 'ativo' : 'indisponível (o status continua pelo /api/jobs)'}</dd>
          <dt>Acesso pela rede</dt><dd>{health.lan_token ? 'habilitado com token' : 'somente este computador'}</dd>
        </dl>
      )}
      <button className="quiet" onClick={refresh}>Atualizar</button>
    </section>
  );
}
