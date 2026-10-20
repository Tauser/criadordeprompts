from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from fakes import FakeComfy
from prisma_studio.api.app import Container, create_app
from prisma_studio.config import Config
from prisma_studio.infrastructure.system_monitor import SystemMonitor, parse_gpus

CATALOG = Path(__file__).resolve().parents[2] / 'catalog' / 'defaults.json'
GPU = {'name': 'Fake GPU', 'utilization': 97.0, 'temperature': 64.0, 'power_draw': 180.5, 'power_limit': 200.0,
       'memory_used': 9 * 2**30, 'memory_total': 12 * 2**30}


class NoProgress:
    def snapshot(self, _):
        return None

    def start(self):
        pass

    def stop(self):
        pass


class FixedMonitor(SystemMonitor):
    def __init__(self, data_dir, gpus):
        super().__init__(data_dir)
        self.readings = gpus

    def gpus(self):
        return self.readings


def make_client(tmp_path, gpus):
    config = Config(data_dir=tmp_path, catalog_path=CATALOG, frontend_dir=tmp_path / 'none', start_workers=False)
    container = Container(config, comfy=FakeComfy(), progress=NoProgress(), monitor=FixedMonitor(tmp_path, gpus))
    container.executor.validate = False
    client = TestClient(create_app(config, container))
    client.container = container
    return client


def test_parse_nvidia_smi_lines_and_unsupported_values():
    rows = parse_gpus('NVIDIA GeForce RTX 4070, 4, 38, 25.08, 200.00, 9662, 12282\n'
                      'Old GPU, [N/A], 50, [Not Supported], [Not Supported], 100, 2048\n'
                      'broken line\n')
    assert rows[0] == {'name': 'NVIDIA GeForce RTX 4070', 'utilization': 4.0, 'temperature': 38.0, 'power_draw': 25.08,
                       'power_limit': 200.0, 'memory_used': 9662 * 2**20, 'memory_total': 12282 * 2**20}
    assert rows[1]['utilization'] is None and rows[1]['power_limit'] is None
    assert len(rows) == 2


@pytest.mark.parametrize('gpus', [[GPU], None])
def test_stats_report_machine_and_usage_with_estimated_energy(tmp_path, gpus):
    client = make_client(tmp_path, gpus)
    with client:
        request = {'mode': 'generate', 'attributes': {
            'environment': {'intent': 'set', 'value': {'kind': 'catalog', 'item_id': 'environment.garden'}}}}
        run = client.post('/api/runs', json={'request_id': 'stats-test-0000001', 'request': request}).json()
        for _ in range(15):
            client.container.executor.tick()
        assert client.get(f'/api/runs/{run["id"]}').json()['status'] == 'completed'
        with client.container.db.transaction() as tx:     # give the finished tasks a known duration
            tx.execute('UPDATE tasks SET started_at=100, ended_at=136 WHERE run_id=?', (run['id'],))

        stats = client.get('/api/stats', params={'since': 0}).json()
        assert stats['comfy']['available'] and stats['comfy']['devices'][0]['vram_total'] == 12 * 2**30
        assert stats['disk']['total'] > 0 and stats['disk']['studio_bytes'] > 0
        usage = stats['usage']
        assert usage['runs'] == 1 and usage['failed'] == 0 and usage['images'] == 1
        assert usage['gpu_seconds'] == 36 * len(client.container.runs.tasks(run['id']))
        if gpus:
            assert stats['gpus'][0]['utilization'] == 97.0
            assert usage['energy_kwh'] == round(usage['gpu_seconds'] * 200 / 3_600_000, 3)
        else:
            assert stats['gpus'] is None and usage['energy_kwh'] is None

        later = client.get('/api/stats', params={'since': 9e12}).json()['usage']
        assert later['runs'] == 0 and later['gpu_seconds'] == 0


def test_stats_without_comfy(tmp_path):
    client = make_client(tmp_path, None)
    with client:
        client.container.comfy.offline = True
        assert client.get('/api/stats').json()['comfy'] == {'available': False}
