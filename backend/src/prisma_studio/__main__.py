"""python -m prisma_studio [--host 127.0.0.1] [--port 8780]"""
import argparse

import uvicorn

from .api.app import create_app
from .config import Config


def main() -> None:
    parser = argparse.ArgumentParser(description='Prisma Studio')
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8780)
    args = parser.parse_args()
    config = Config()
    if args.host not in ('127.0.0.1', 'localhost') and not config.token:
        raise SystemExit('Para abrir na rede local, defina PRISMA_TOKEN.')
    uvicorn.run(create_app(config), host=args.host, port=args.port, log_level='info')


if __name__ == '__main__':
    main()
