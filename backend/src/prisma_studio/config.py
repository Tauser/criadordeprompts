"""Runtime configuration from environment variables and command-line flags."""
from __future__ import annotations

import ipaddress
import os
import re
from dataclasses import dataclass, field
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[3]
PRIVATE_LANS = tuple(ipaddress.ip_network(value) for value in ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16',
                                                             'fc00::/7'))


@dataclass(frozen=True)
class Config:
    data_dir: Path = field(default_factory=lambda: Path(os.environ.get('PRISMA_DATA_DIR', PROJECT_ROOT / 'data')))
    comfy_url: str = field(default_factory=lambda: os.environ.get('PRISMA_COMFY_URL', 'http://127.0.0.1:8188'))
    catalog_path: Path = field(default_factory=lambda: PROJECT_ROOT / 'catalog' / 'defaults.json')
    frontend_dir: Path = field(default_factory=lambda: PROJECT_ROOT / 'frontend' / 'dist')
    token: str | None = field(default_factory=lambda: os.environ.get('PRISMA_TOKEN') or None)
    allowed_networks: tuple[str, ...] = field(default_factory=lambda: tuple(
        value.strip() for value in os.environ.get('PRISMA_ALLOW_NETWORKS', '').split(',') if value.strip()))
    lan_hosts: tuple[str, ...] = field(default_factory=lambda: tuple(
        value.strip() for value in os.environ.get('PRISMA_LAN_HOSTS', '').split(',') if value.strip()))
    lan_alias: str | None = field(default_factory=lambda: os.environ.get('PRISMA_LAN_ALIAS') or None)
    http_port: int = 8780
    start_workers: bool = True

    def __post_init__(self):
        networks = tuple(ipaddress.ip_network(value, strict=False) for value in self.allowed_networks)
        if any(not any(network.version == lan.version and network.subnet_of(lan) for lan in PRIVATE_LANS)
               for network in networks):
            raise ValueError('O acesso sem senha só aceita sub-redes locais privadas explícitas.')
        hosts = tuple(str(ipaddress.ip_address(value)) for value in self.lan_hosts)
        if networks and not hosts:
            raise ValueError('Informe o IP local do Studio com --lan-ip para liberar a rede local.')
        if any(not any(ipaddress.ip_address(host) in network for network in networks) for host in hosts):
            raise ValueError('O IP local precisa pertencer a uma das sub-redes liberadas.')
        object.__setattr__(self, 'allowed_networks', tuple(str(network) for network in networks))
        object.__setattr__(self, 'lan_hosts', hosts)
        if self.lan_alias:
            alias = self.lan_alias.lower()
            if not re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.local', alias):
                raise ValueError('O alias precisa ser um nome simples terminado em .local, como studio.local.')
            if not networks or not any(ipaddress.ip_address(host).version == 4 for host in hosts):
                raise ValueError('O alias mDNS exige uma rede local autorizada e um IP IPv4 local.')
            object.__setattr__(self, 'lan_alias', alias)
        if not 1 <= self.http_port <= 65535:
            raise ValueError('Porta HTTP inválida.')
