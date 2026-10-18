import asyncio

from prisma_studio.config import Config
from prisma_studio.infrastructure import discovery


def test_mdns_advertises_only_selected_interface_and_cleans_up(monkeypatch):
    events = []

    class FakeZeroconf:
        def __init__(self, **options):
            events.append(options)

        async def async_register_service(self, info, **options):
            events.append((info, options))
            return asyncio.sleep(0)

        async def async_unregister_service(self, info):
            events.append('unregister')
            return asyncio.sleep(0)

        async def async_close(self):
            events.append('close')

    monkeypatch.setattr(discovery, 'AsyncZeroconf', FakeZeroconf)
    config = Config(lan_alias='studio.local', http_port=9890, allowed_networks=('192.168.1.0/24',),
                    lan_hosts=('192.168.1.3',))
    service = discovery.LocalDiscovery(config)

    async def run():
        await service.start()
        assert service.status == 'advertising'
        await service.close()

    asyncio.run(run())
    assert events[0]['interfaces'] == ['192.168.1.3']
    info, options = events[1]
    assert info.server == 'studio.local.' and info.port == 9890
    assert info.parsed_addresses() == ['192.168.1.3']
    assert options == {'allow_name_change': False}
    assert events[2:] == ['unregister', 'close']


def test_mdns_failure_is_reported_without_preventing_ip_access(monkeypatch):
    def fail(**options):
        raise OSError('test: interface unavailable')

    monkeypatch.setattr(discovery, 'AsyncZeroconf', fail)
    service = discovery.LocalDiscovery(Config(lan_alias='studio.local', allowed_networks=('192.168.1.0/24',),
                                              lan_hosts=('192.168.1.3',)))
    asyncio.run(service.start())
    assert service.status == 'error'
    assert 'interface unavailable' in service.error
