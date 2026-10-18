from contextlib import contextmanager
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from fakes import FakeComfy, png
from prisma_studio.api.app import Container, create_app
from prisma_studio.config import Config
from test_api import NoProgress


@contextmanager
def lan_client(tmp_path, peer='192.168.1.50', **changes):
    config = Config(data_dir=tmp_path, frontend_dir=tmp_path / 'none',
                    catalog_path=Path(__file__).resolve().parents[2] / 'catalog/defaults.json',
                    start_workers=False, allowed_networks=('192.168.1.3/24',), lan_hosts=('192.168.1.3',),
                    **changes)
    comfy = FakeComfy()
    comfy.system_stats = lambda: {'system': {}, 'devices': []}
    container = Container(config, comfy=comfy, progress=NoProgress())
    app = create_app(config, container)

    async def from_peer(scope, receive, send):
        if scope['type'] == 'http':
            scope = {**scope, 'client': (peer, 12345)}
        await app(scope, receive, send)

    with TestClient(from_peer, base_url='http://192.168.1.3:8780') as client:
        yield client


def test_lan_browser_reads_writes_and_downloads_without_token(tmp_path):
    with lan_client(tmp_path) as client:
        health = client.get('/api/health').json()
        assert health['network_access'] == {'mode': 'lan', 'allowed_networks': ['192.168.1.0/24'],
                                             'urls': ['http://192.168.1.3:8780/'],
                                             'mdns': {'name': None, 'status': 'disabled', 'error': None}}
        assert not health['lan_token']
        headers = {'origin': 'http://192.168.1.3:8780'}
        assert client.post('/api/prepare', json={'mode': 'generate'}, headers=headers).status_code == 200
        image = client.post('/api/files', files={'file': ('image.png', png(), 'image/png')}, headers=headers)
        assert image.status_code == 200
        assert client.get('/api/files/' + image.json()['hash']).status_code == 200


@pytest.mark.parametrize('peer', ['192.168.2.50', '10.0.0.5', '203.0.113.7'])
def test_other_networks_are_not_authorized_by_lan_mode(tmp_path, peer):
    with lan_client(tmp_path, peer) as client:
        assert client.get('/api/contract').status_code == 401


@pytest.mark.parametrize('origin', ['http://evil.example', 'http://192.168.1.3:9999',
                                   'http://localhost:5173', 'null', 'http://user@192.168.1.3:8780'])
def test_lan_writes_reject_foreign_origins(tmp_path, origin):
    with lan_client(tmp_path) as client:
        assert client.post('/api/prepare', json={'mode': 'generate'},
                           headers={'origin': origin}).status_code == 403


def test_lan_rejects_an_unknown_host_header(tmp_path):
    with lan_client(tmp_path) as client:
        assert client.get('/api/contract', headers={'host': 'attacker.example:8780'}).status_code == 400


def test_local_and_ipv4_mapped_clients_remain_usable(tmp_path):
    for index, peer in enumerate(['127.0.0.1', '::1', '::ffff:192.168.1.50']):
        with lan_client(tmp_path / str(index), peer) as client:
            assert client.get('/api/contract').status_code == 200


def test_external_client_still_needs_a_valid_configured_token(tmp_path):
    with lan_client(tmp_path, '203.0.113.7', token='test-only-secret') as client:
        assert client.get('/api/contract').status_code == 401
        assert client.get('/api/contract', headers={'x-studio-token': 'incorrect'}).status_code == 401
        assert client.get('/api/contract', headers={'x-studio-token': 'test-only-secret'}).status_code == 200


@pytest.mark.parametrize('network', ['0.0.0.0/0', '::/0', '203.0.113.0/24'])
def test_passwordless_access_cannot_allow_the_public_internet(network):
    with pytest.raises(ValueError, match='privadas'):
        Config(allowed_networks=(network,), lan_hosts=('192.168.1.3',))


def test_lan_mode_requires_a_host_in_the_selected_network():
    with pytest.raises(ValueError, match='IP local'):
        Config(allowed_networks=('192.168.1.0/24',), lan_hosts=())
    with pytest.raises(ValueError, match='pertencer'):
        Config(allowed_networks=('192.168.1.0/24',), lan_hosts=('192.168.2.3',))


def test_cli_accepts_explicit_lan_settings(monkeypatch):
    import prisma_studio.__main__ as cli

    captured = {}
    monkeypatch.setattr('sys.argv', ['prisma_studio', '--host', '0.0.0.0', '--lan-ip', '192.168.1.3',
                                    '--allow-network', '192.168.1.3/24'])
    monkeypatch.setattr(cli, 'create_app', lambda config: config)
    monkeypatch.setattr(cli.uvicorn, 'run', lambda app, **kwargs: captured.update(app=app, **kwargs))
    cli.main()
    assert captured['host'] == '0.0.0.0'
    assert captured['app'].allowed_networks == ('192.168.1.0/24',)


def test_alias_accepts_browser_requests_without_weakening_origin_or_peer_checks(tmp_path, monkeypatch):
    from prisma_studio.infrastructure.discovery import LocalDiscovery

    async def start(self):
        self.status = 'advertising'

    monkeypatch.setattr(LocalDiscovery, 'start', start)
    with lan_client(tmp_path, lan_alias='studio.local', http_port=9890) as client:
        headers = {'host': 'studio.local:9890', 'origin': 'http://studio.local:9890'}
        health = client.get('/api/health', headers=headers).json()['network_access']
        assert health['urls'] == ['http://192.168.1.3:9890/', 'http://studio.local:9890/']
        assert health['mdns'] == {'name': 'studio.local', 'status': 'advertising', 'error': None}
        assert client.post('/api/prepare', json={'mode': 'generate'}, headers=headers).status_code == 200
        assert client.post('/api/prepare', json={'mode': 'generate'},
                           headers={**headers, 'origin': 'http://evil.local:9890'}).status_code == 403
    with lan_client(tmp_path / 'outside', peer='203.0.113.7', lan_alias='studio.local') as client:
        assert client.get('/api/contract', headers={'host': 'studio.local:8780'}).status_code == 401


@pytest.mark.parametrize('alias', ['studio', 'studio.example', 'x.y.local', '-studio.local',
                                 'studio.local:8780', 'studio.local/path'])
def test_invalid_alias_is_rejected(alias):
    with pytest.raises(ValueError, match='alias'):
        Config(lan_alias=alias, allowed_networks=('192.168.1.0/24',), lan_hosts=('192.168.1.3',))


def test_alias_requires_an_explicit_private_interface():
    with pytest.raises(ValueError, match='IPv4'):
        Config(lan_alias='studio.local')
