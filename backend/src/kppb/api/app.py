"""HTTP interface. Converts use-case results and failures into responses; decides nothing."""
from __future__ import annotations

import asyncio
import ipaddress
import json
import re
import secrets
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, HTTPException, Request as HttpRequest, UploadFile
from fastapi.responses import JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .. import __version__
from ..application.library import LibraryService
from ..application.runs import RequestRejected, RunService, prepare
from ..application.translation import TranslationService
from ..config import Config
from ..domain.request import Request
from ..domain.vocabulary import CATEGORIES
from ..infrastructure.comfy.client import ComfyClient, ComfyRejected, ComfyUnavailable
from ..infrastructure.comfy.progress import ProgressTracker
from ..infrastructure.comfy.workflows import PROFILES, generation_size
from ..infrastructure.db.database import Database
from ..infrastructure.db.repository import InvalidTransition, LibraryRepository, RunRepository
from ..infrastructure.storage.files import FileStore
from ..worker.executor import PHASES, Executor

REQUEST_ID = re.compile(r'^[A-Za-z0-9-]{16,64}$')


class RunCreate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    request_id: str = Field(pattern=REQUEST_ID.pattern)
    request: dict
    files: dict[str, str] = {}
    mask: str | None = None


class RunDelete(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=200)
    keep_files: list[str] = Field(default=[], max_length=50)


class Review(BaseModel):
    choice: str


class LibrarySave(BaseModel):
    revision: int
    items: list[dict]


class TranslationCreate(BaseModel):
    text: str


class Container:
    def __init__(self, config: Config, comfy=None, progress=None):
        self.config = config
        self.db = Database(config.data_dir / 'studio.db')
        self.store = FileStore(config.data_dir / 'files')
        self.runs = RunRepository(self.db)
        self.comfy = comfy or ComfyClient(config.comfy_url)
        self.progress = progress if progress is not None else ProgressTracker(config.comfy_url, self.comfy.client_id)
        self.library = LibraryService(config.catalog_path, LibraryRepository(self.db))
        self.executor = Executor(self.runs, self.comfy, self.store, self.progress)
        self.service = RunService(self.runs, self.library, self.store, self.executor)
        self.translation = TranslationService(self.comfy)


def create_app(config: Config | None = None, container: Container | None = None) -> FastAPI:
    config = config or Config()
    c = container or Container(config)

    @asynccontextmanager
    async def lifespan(_app):
        if config.start_workers:
            c.progress.start()
            c.executor.start()
        yield
        c.executor.stop()
        c.progress.stop()

    app = FastAPI(title='KPPB Studio', version=__version__, lifespan=lifespan)
    app.state.container = c

    @app.middleware('http')
    async def guard(request: HttpRequest, call_next):
        host = request.client.host if request.client else '127.0.0.1'
        try:
            local = ipaddress.ip_address(host).is_loopback
        except ValueError:
            local = host in ('testclient', 'localhost')
        if not local:
            token = request.headers.get('x-studio-token') or request.cookies.get('kppb_token')
            if not config.token or not token or not secrets.compare_digest(token, config.token):
                return JSONResponse({'error': 'Acesso pela rede exige o token do Studio.'}, status_code=401)
        if request.method in ('POST', 'PUT', 'DELETE'):
            origin = request.headers.get('origin')
            origin_host = origin.split('://', 1)[-1].split(':', 1)[0] if origin else None
            same = origin and origin.split('://', 1)[-1] == request.headers.get('host')
            if origin and not same and not (local and origin_host in ('127.0.0.1', 'localhost')):
                return JSONResponse({'error': 'Origem não permitida.'}, status_code=403)
        return await call_next(request)

    @app.exception_handler(RequestRejected)
    async def rejected(_r, error: RequestRejected):
        return JSONResponse({'error': str(error), 'issues': error.issues}, status_code=422)

    @app.exception_handler(ValidationError)
    async def invalid(_r, error: ValidationError):
        return JSONResponse({'error': 'Pedido fora do contrato.', 'details': json.loads(error.json())[:20]},
                            status_code=422)

    @app.exception_handler(ComfyUnavailable)
    async def offline(_r, _e):
        return JSONResponse({'error': 'O ComfyUI não respondeu. Abra-o e tente novamente.'}, status_code=503)

    @app.exception_handler(ComfyRejected)
    async def comfy_rejected(_r, error):
        return JSONResponse({'error': str(error)}, status_code=502)

    @app.exception_handler(InvalidTransition)
    async def conflict(_r, error):
        return JSONResponse({'error': str(error)}, status_code=409)

    @app.exception_handler(KeyError)
    async def missing(_r, _e):
        return JSONResponse({'error': 'Não encontrado.'}, status_code=404)

    @app.exception_handler(ValueError)
    async def bad_value(_r, error):
        return JSONResponse({'error': str(error)}, status_code=400)

    # diagnostics ---------------------------------------------------------------
    @app.get('/api/health')
    def health():
        try:
            stats = c.comfy.system_stats()
            comfy = {'available': True, 'version': stats.get('system', {}).get('comfyui_version'),
                     'devices': [d.get('name') for d in stats.get('devices', [])]}
        except (ComfyUnavailable, ComfyRejected):
            comfy = {'available': False}
        return {'studio_version': __version__, 'data_dir': str(config.data_dir), 'comfy_url': config.comfy_url,
                'comfy': comfy, 'progress_live': c.progress.connected.is_set() if hasattr(c.progress, 'connected')
                else False, 'lan_token': bool(config.token)}

    @app.get('/api/contract')
    def contract():
        return {'schema': Request.model_json_schema(), 'categories': CATEGORIES,
                'profiles': {k: {**v} for k, v in PROFILES.items()},
                'sizes': {r: {a: generation_size(r, a) for a in ('3:4', '2:3', '1:1', '16:9', '9:16', '4:3', '3:2')}
                          for r in (1024, 1536, 2048)}}

    # library ---------------------------------------------------------------------
    @app.get('/api/library')
    def library():
        return c.library.snapshot()

    @app.put('/api/library')
    def save_library(body: LibrarySave):
        return c.library.save(body.revision, body.items)

    # files -----------------------------------------------------------------------
    @app.post('/api/files')
    async def upload(file: UploadFile = File(...)):
        data = await file.read(26 * 1024 * 1024)
        stored = c.store.put(data)
        c.runs.record_file(stored)
        return {'hash': stored.hash, 'mime': stored.mime, 'width': stored.width, 'height': stored.height}

    @app.get('/api/files/{file_hash}')
    def download(file_hash: str):
        record = c.runs.file(file_hash)
        if record is None:
            raise HTTPException(404, 'Arquivo não encontrado.')
        return Response(c.store.read(file_hash), media_type=record['mime'],
                        headers={'Cache-Control': 'private, max-age=31536000, immutable'})

    # requests and runs -------------------------------------------------------------
    @app.post('/api/prepare')
    def prepare_request(body: dict):
        return prepare(Request.model_validate(body), c.library.library())

    @app.post('/api/runs')
    def create_run(body: RunCreate):
        run = c.service.create(Request.model_validate(body.request), body.request_id, body.files, body.mask)
        return run_view(run)

    @app.get('/api/runs')
    def list_runs(limit: int = 30):
        return {'runs': [run_view(r, detail=False) for r in c.runs.list(min(max(limit, 1), 200))]}

    @app.get('/api/runs/by-request/{request_id}')
    def by_request(request_id: str):
        run = c.runs.by_request(request_id)
        if run is None:
            raise HTTPException(404, 'Nenhum pedido com esse identificador.')
        return run_view(run)

    @app.get('/api/runs/{run_id}')
    def get_run(run_id: str):
        run = c.runs.get(run_id)
        if run is None:
            raise HTTPException(404, 'Pedido não encontrado.')
        return run_view(run)

    @app.post('/api/runs/delete')
    def delete_runs(body: RunDelete):
        results = [c.service.delete(run_id, set(body.keep_files)) for run_id in body.ids]
        return {'deleted': [r['deleted'] for r in results], 'files_removed': sum(r['files_removed'] for r in results)}

    @app.post('/api/runs/{run_id}/cancel')
    def cancel_run(run_id: str):
        return run_view(c.service.cancel(run_id))

    @app.post('/api/runs/{run_id}/review')
    def review(run_id: str, body: Review):
        return run_view(c.service.approve(run_id, body.choice))

    @app.get('/api/runs/{run_id}/events')
    async def events(run_id: str, request: HttpRequest):
        if c.runs.get(run_id) is None:
            raise HTTPException(404, 'Pedido não encontrado.')
        last = int(request.headers.get('last-event-id') or 0)

        async def stream():
            nonlocal last
            idle = 0
            while not await request.is_disconnected():
                for event in c.runs.events(run_id, last):
                    last = event['id']
                    yield f'id: {last}\nevent: {event["type"]}\ndata: {json.dumps(event, ensure_ascii=False)}\n\n'
                run = c.runs.get(run_id)
                yield f'event: snapshot\ndata: {json.dumps(run_view(run), ensure_ascii=False, default=str)}\n\n'
                if run['status'] in ('completed', 'failed', 'cancelled', 'lost'):
                    idle += 1
                    if idle > 1:
                        break
                await asyncio.sleep(1)
        return StreamingResponse(stream(), media_type='text/event-stream', headers={'Cache-Control': 'no-store'})

    # translation -------------------------------------------------------------------
    @app.post('/api/translations')
    def translate(body: TranslationCreate):
        return c.translation.start(body.text)

    @app.get('/api/translations/{job_id}')
    def translation(job_id: str):
        return c.translation.status(job_id)

    @app.post('/api/translations/{job_id}/cancel')
    def cancel_translation(job_id: str):
        return c.translation.cancel(job_id)

    def run_view(run: dict, detail: bool = True) -> dict:
        view = {k: run[k] for k in ('id', 'request_id', 'status', 'mode', 'prompt', 'effective_prompt',
                                    'refined_prompt', 'error', 'best_task_id', 'cancel_requested', 'created_at',
                                    'updated_at')}
        settings = run['settings']
        view['settings'] = {k: settings.get(k) for k in ('profile', 'resolution', 'width', 'height', 'variations',
                                                          'seed', 'verify', 'refine', 'checks', 'compiler_version')}
        tasks = c.runs.tasks(run['id'])
        view['images'] = [{'task_id': t['id'], 'position': t['position'], 'seed': t['seed'], 'status': t['status'],
                           'files': (t['result'] or {}).get('files', []), 'score': (t['result'] or {}).get('score'),
                           'verdicts': (t['result'] or {}).get('verdicts')} for t in tasks if t['kind'] == 'image']
        if detail:
            view['request'] = run['request']
            view['files'] = run['files']
            view['tasks'] = [task_view(t) for t in tasks]
            view['events'] = c.runs.events(run['id'])[-50:]
        return view

    def task_view(task: dict) -> dict:
        view = {k: task[k] for k in ('id', 'kind', 'position', 'status', 'seed', 'comfy_prompt_id', 'error',
                                     'submitted_at', 'started_at', 'ended_at', 'timings')}
        if task['status'] in ('queued', 'running') and task['comfy_prompt_id']:
            snapshot = c.progress.snapshot(task['comfy_prompt_id']) if c.progress else None
            if snapshot:
                node = snapshot.get('node')
                cls = (task.get('graph') or {}).get(str(node), {}).get('class_type') if node is not None else None
                view['live'] = {'phase': PHASES.get(cls, 'preparing') if cls else None, 'node_class': cls,
                                'value': snapshot.get('value'), 'maximum': snapshot.get('maximum'),
                                'since': snapshot.get('node_started')}
        return view

    if config.frontend_dir.exists():
        app.mount('/', StaticFiles(directory=config.frontend_dir, html=True), name='frontend')
    return app
