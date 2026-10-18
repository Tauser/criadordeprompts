"""Advertise the HTTP service on the explicitly selected private IPv4 interfaces."""
from __future__ import annotations

import ipaddress
import logging

from zeroconf import IPVersion, ServiceInfo
from zeroconf.asyncio import AsyncZeroconf

from ..config import Config

logger = logging.getLogger(__name__)


class LocalDiscovery:
    def __init__(self, config: Config):
        self.config = config
        self.status = 'disabled' if not config.lan_alias else 'pending'
        self.error: str | None = None
        self.zeroconf = None
        self.info = None

    async def start(self):
        if not self.config.lan_alias:
            return
        addresses = [host for host in self.config.lan_hosts if ipaddress.ip_address(host).version == 4]
        try:
            self.zeroconf = AsyncZeroconf(interfaces=addresses, ip_version=IPVersion.V4Only)
            self.info = ServiceInfo(
                '_http._tcp.local.', f'{self.config.lan_alias[:-6]}._http._tcp.local.',
                server=self.config.lan_alias + '.', parsed_addresses=addresses,
                port=self.config.http_port, properties={'path': '/', 'app': 'Prisma Studio'},
            )
            # The API returns the broadcast task; await it too before reporting readiness.
            await (await self.zeroconf.async_register_service(self.info, allow_name_change=False))
            self.status = 'advertising'
            logger.info('Alias mDNS ativo: http://%s:%s/', self.config.lan_alias, self.config.http_port)
        except Exception as error:
            self.status = 'error'
            self.error = f'{type(error).__name__}: {error}'
            logger.warning('Não foi possível anunciar o alias mDNS: %s', self.error)
            await self.close()

    async def close(self):
        if self.zeroconf is not None:
            try:
                if self.status == 'advertising' and self.info is not None:
                    await (await self.zeroconf.async_unregister_service(self.info))
            finally:
                await self.zeroconf.async_close()
                self.zeroconf = None
