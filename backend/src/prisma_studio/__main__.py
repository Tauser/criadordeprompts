"""python -m prisma_studio [--host 127.0.0.1] [--port 8780]"""
import argparse

import uvicorn

from .api.app import create_app
from .config import Config


def main() -> None:
    parser = argparse.ArgumentParser(description='Prisma Studio')
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8780)
    parser.add_argument('--allow-network', action='append', default=None,
                        help='Sub-rede privada autorizada sem senha; pode ser repetida.')
    parser.add_argument('--lan-ip', action='append', default=None, help='IP local usado para acessar o Studio.')
    parser.add_argument('--lan-alias', default=None, help='Nome mDNS na rede privada, por exemplo studio.local.')
    args = parser.parse_args()
    overrides = {'http_port': args.port}
    if args.lan_alias is not None:
        overrides['lan_alias'] = args.lan_alias
    if args.allow_network is not None:
        overrides['allowed_networks'] = tuple(args.allow_network)
    if args.lan_ip is not None:
        overrides['lan_hosts'] = tuple(args.lan_ip)
    config = Config(**overrides)
    if args.host not in ('127.0.0.1', 'localhost', '::1') and not (config.token or config.allowed_networks):
        raise SystemExit('Para abrir na rede, informe --allow-network e --lan-ip ou defina PRISMA_TOKEN.')
    uvicorn.run(create_app(config), host=args.host, port=args.port, log_level='info')


if __name__ == '__main__':
    main()
