import {useEffect, useState} from 'react';
import {api} from '../api/client';
import type {Health, Stats} from '../api/types';
import {formatSeconds} from '../lib/progress';
import {Segmented, Tip} from './Controls';

const GB = 1024 ** 3;
const number = (value: number, digits = 1) => value.toLocaleString('pt-BR', {maximumFractionDigits: digits, minimumFractionDigits: digits});
export const gigabytes = (bytes: number) => number(bytes / GB);
export const level = (fraction: number) => fraction >= .95 ? 'bad' : fraction >= .8 ? 'warn' : 'ok';

type Period = 'today' | 'week' | 'month';
const PERIODS: Record<Period, string> = {today: 'Hoje', week: '7 dias', month: '30 dias'};
const since = (period: Period) => {
  if (period !== 'today') return Date.now() / 1000 - (period === 'week' ? 7 : 30) * 86400;
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  return midnight.getTime() / 1000;
};

function Meter({label, value, unit, fraction, detail}: {label: string; value: string; unit?: string; fraction: number | null; detail: string}) {
  return (
    <section className="card meter" aria-label={label}>
      <span className="meter-label">{label}</span>
      <strong className="meter-value num">{value}{unit && <span> {unit}</span>}</strong>
      <span className={'meter-bar ' + (fraction == null ? '' : level(fraction))} role="meter" aria-label={label}
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={fraction == null ? undefined : Math.round(fraction * 100)}>
        <i style={{width: `${Math.round((fraction ?? 0) * 100)}%`}} /></span>
      <span className="meter-detail">{detail}</span>
    </section>
  );
}

export function Diagnostics({health, refresh}: {health: Health | null; refresh: () => void}) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState('');
  const [period, setPeriod] = useState<Period>('today');
  const [tick, setTick] = useState(0);

  // Readings refresh every 3 s while this page is open.
  useEffect(() => {
    let alive = true;
    const load = () => api.stats(since(period)).then(s => {if (alive) {setStats(s); setError('');}})
      .catch(e => {if (alive) setError((e as Error).message);});
    load();
    const timer = window.setInterval(load, 3000);
    return () => {alive = false; window.clearInterval(timer);};
  }, [period, tick]);

  const device = stats?.comfy.devices?.[0];
  const gpu = stats?.gpus?.[0];
  const vramTotal = device?.vram_total ?? gpu?.memory_total ?? null;
  const vramUsed = device?.vram_total != null && device.vram_free != null ? device.vram_total - device.vram_free : gpu?.memory_used ?? null;
  const ramTotal = stats?.comfy.ram_total ?? null, ramFree = stats?.comfy.ram_free ?? null;
  const usage = stats?.usage;
  const deviceName = (gpu?.name ?? device?.name ?? '').replace(/^cuda:\d+\s*/, '').replace(/\s*:.*$/, '').replace(/^NVIDIA\s+(GeForce\s+)?/, '');

  return (
    <section className="diagnostics">
      <header className="page-head"><div><h1>Diagnóstico</h1>
        <p className="muted">Estado do Studio, da conexão com o ComfyUI e do consumo da máquina.</p></div>
        <span className="muted small">{error ? 'Sem leitura' : stats ? 'Atualiza a cada 3 s' : 'Lendo…'}</span>
        <button className="quiet" onClick={() => {refresh(); setTick(t => t + 1);}}>Atualizar</button></header>
      {error && <p className="issue warning">{error}</p>}

      <div className="meters">
        <Meter label={`VRAM${deviceName ? ` · ${deviceName}` : ''}`}
          value={vramUsed != null ? gigabytes(vramUsed) : '—'} unit={vramTotal ? `/ ${gigabytes(vramTotal)} GB` : undefined}
          fraction={vramUsed != null && vramTotal ? vramUsed / vramTotal : null}
          detail={vramUsed != null && vramTotal ? `${Math.round(vramUsed / vramTotal * 100)}% em uso` : stats?.comfy.available === false ? 'ComfyUI offline' : 'Sem leitura'} />
        <Meter label="RAM do sistema" value={ramTotal != null && ramFree != null ? gigabytes(ramTotal - ramFree) : '—'}
          unit={ramTotal ? `/ ${gigabytes(ramTotal)} GB` : undefined}
          fraction={ramTotal && ramFree != null ? (ramTotal - ramFree) / ramTotal : null}
          detail={ramTotal && ramFree != null ? `${Math.round((ramTotal - ramFree) / ramTotal * 100)}% em uso` : 'Lida pelo ComfyUI'} />
        <Meter label="GPU" value={gpu?.utilization != null ? `${Math.round(gpu.utilization)}%` : '—'} unit={gpu?.utilization != null ? 'de uso' : undefined}
          fraction={gpu?.utilization != null ? gpu.utilization / 100 : null}
          detail={gpu ? [gpu.temperature != null && `${Math.round(gpu.temperature)} °C`, gpu.power_draw != null && `${Math.round(gpu.power_draw)} W`]
            .filter(Boolean).join(' · ') || 'Sem temperatura e potência' : stats ? 'nvidia-smi não disponível' : 'Lendo…'} />
        <Meter label={`Disco${stats ? ` · ${stats.disk.path.replace(/\\$/, '')}` : ''}`}
          value={stats ? number(stats.disk.free / GB, 0) : '—'} unit={stats ? 'GB livres' : undefined}
          fraction={stats ? 1 - stats.disk.free / stats.disk.total : null}
          detail={stats?.disk.studio_bytes != null ? `Studio ocupa ${gigabytes(stats.disk.studio_bytes)} GB` : 'Lendo…'} />
      </div>

      <section className="card usage" aria-labelledby="usage-title">
        <div className="section-title"><h2 id="usage-title">Uso do Studio</h2>
          <Segmented small label="Período" value={period} onChange={setPeriod}
            options={(Object.keys(PERIODS) as Period[]).map(p => ({value: p, label: PERIODS[p]}))} /></div>
        <dl className="usage-grid">
          <div><dt>Pedidos</dt><dd className="num">{usage?.runs ?? '—'}{usage?.failed ? <span className="muted small"> · {usage.failed} com falha</span> : null}</dd></div>
          <div><dt>Imagens</dt><dd className="num">{usage?.images ?? '—'}</dd></div>
          <div><dt>Tempo de GPU</dt><dd className="num">{usage ? formatSeconds(usage.gpu_seconds) : '—'}</dd></div>
          <div><dt>Média por imagem</dt><dd className="num">{usage?.images ? formatSeconds(usage.gpu_seconds / usage.images) : '—'}</dd></div>
          <div><dt>Energia estimada <Tip>{usage?.power_watts
            ? `Tempo de GPU × potência máxima da placa (${Math.round(usage.power_watts)} W). É uma estimativa, não uma medição na tomada; o consumo real tende a ser um pouco menor.`
            : 'Precisa do nvidia-smi para saber a potência da placa.'}</Tip></dt>
            <dd className="num">{usage?.energy_kwh != null ? `≈ ${number(usage.energy_kwh, usage.energy_kwh < 1 ? 2 : 1)} kWh` : '—'}</dd></div>
        </dl>
      </section>

      <section className="card">
        <h2 className="card-title">Studio e ComfyUI</h2>
        {!health ? <p className="muted">Carregando…</p> : (
          <dl className="facts">
            <dt>Versão do Studio</dt><dd>{health.studio_version}</dd>
            <dt>ComfyUI</dt><dd><code>{health.comfy_url}</code> · {health.comfy.available ? `conectado (versão ${health.comfy.version ?? '?'})` : 'offline'}</dd>
            {health.comfy.devices?.length ? <><dt>GPU</dt><dd>{health.comfy.devices.join(', ')}</dd></> : null}
            <dt>Progresso em tempo real</dt><dd>{health.progress_live ? 'ativo' : 'indisponível (o status continua pelo /api/jobs)'}</dd>
            <dt>Acesso pela rede</dt><dd>{health.network_access?.mode === 'lan'
              ? `rede local sem senha · ${health.network_access.allowed_networks.join(', ')}`
              : health.lan_token ? 'habilitado com token' : 'somente este computador'}</dd>
            {health.network_access?.urls.length ? <><dt>Endereço na rede local</dt><dd>
              {health.network_access.urls.map(url => <div key={url}><a href={url}>{url}</a></div>)}
            </dd></> : null}
            <dt>Diretório de dados</dt><dd><code>{health.data_dir}</code></dd>
          </dl>
        )}
      </section>
    </section>
  );
}
