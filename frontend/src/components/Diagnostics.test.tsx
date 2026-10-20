// @vitest-environment happy-dom
import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import {api} from '../api/client';
import {Diagnostics} from './Diagnostics';

vi.mock('../api/client', () => ({api: {stats: vi.fn()}}));
afterEach(() => {cleanup(); vi.clearAllMocks();});

const GB = 1024 ** 3;

it('shows the machine readings, the usage and asks again for another period', async () => {
  vi.mocked(api.stats).mockResolvedValue({at: 1, gpus: [{name: 'NVIDIA GeForce RTX 4070', utilization: 97, temperature: 64,
    power_draw: 181, power_limit: 200, memory_used: 9 * GB, memory_total: 12 * GB}],
    comfy: {available: true, ram_total: 32 * GB, ram_free: 8 * GB, devices: [{name: 'cuda:0 NVIDIA GeForce RTX 4070 : cudaMallocAsync',
      vram_total: 12 * GB, vram_free: 0.3 * GB}]},
    disk: {path: 'D:\\', total: 1000 * GB, free: 400 * GB, studio_bytes: 3 * GB},
    usage: {runs: 4, failed: 1, images: 5, gpu_seconds: 900, power_watts: 200, energy_kwh: 0.05}});
  render(<Diagnostics health={null} refresh={() => undefined} />);
  expect(await screen.findByText('VRAM · RTX 4070')).toBeTruthy();
  expect(screen.getByText('98% em uso')).toBeTruthy();
  expect(screen.getByText('64 °C · 181 W')).toBeTruthy();
  expect(screen.getByText('3 min 00 s')).toBeTruthy();            // 900 s over 5 images
  expect(screen.getByText('≈ 0,05 kWh')).toBeTruthy();
  expect(screen.getByRole('meter', {name: 'VRAM · RTX 4070'}).className).toContain('bad');
  fireEvent.click(screen.getByRole('radio', {name: '7 dias'}));
  await waitFor(() => expect(vi.mocked(api.stats).mock.calls.length).toBeGreaterThan(1));
  const [week] = vi.mocked(api.stats).mock.calls.at(-1)!;
  expect(Date.now() / 1000 - (week as number)).toBeCloseTo(7 * 86400, -2);
});
