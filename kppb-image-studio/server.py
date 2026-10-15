"""Local prompt studio with direct, untranslated ComfyUI requests."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import argparse
import base64
import json
import ipaddress
import math
import re
import secrets
import threading
import uuid
import urllib.error
import urllib.parse
import urllib.request
import workflow_adapter as workflows
from comfy_progress import ComfyProgress

ROOT = Path(__file__).resolve().parent
PUBLIC_FILES = {'/KPPB_Image_Studio_v5_1.html', '/textos-prompts.js', '/studio-workflows.js', '/studio-workflows.css', '/acoes-edicao.js'}
COMFY = 'http://127.0.0.1:8188'
COMFY_CLIENT_ID = 'kppb-studio'
PROGRESS = ComfyProgress(COMFY, COMFY_CLIENT_ID)
WORKFLOW = ROOT.parent / 'workflows' / 'presets-api' / 'editor-qwen21-turbo-oficial.json'
JOBS_PATH = ROOT / 'jobs.json'
JOBS_LOCK = threading.Lock()
try:
    JOBS = json.loads(JOBS_PATH.read_text(encoding='utf-8'))
except (OSError, ValueError):
    JOBS = {}
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))

def comfy(endpoint, payload=None, timeout=30):
    data = None if payload is None else json.dumps(payload).encode('utf-8')
    request = urllib.request.Request(COMFY + endpoint, data=data, headers={'Content-Type': 'application/json'})
    try:
        with OPENER.open(request, timeout=timeout) as response:
            raw = response.read()
            return json.loads(raw) if raw.strip() else {}
    except urllib.error.HTTPError as error:
        details = error.read().decode('utf-8', errors='replace')
        raise ValueError('ComfyUI recusou o workflow: ' + details[:1800]) from error

def upload_image(image):
    if not isinstance(image, dict) or image.get('mime') not in ('image/png', 'image/jpeg', 'image/webp'):
        raise ValueError('Use referências PNG, JPG ou WEBP.')
    raw = base64.b64decode(image.get('data', ''), validate=True)
    if not raw or len(raw) > 12 * 1024 * 1024:
        raise ValueError('Cada referência deve ter até 12 MB.')
    suffix = {'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp'}[image['mime']]
    filename = 'kppb_' + uuid.uuid4().hex + suffix
    boundary = 'kppb_' + uuid.uuid4().hex
    body = (
        f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="{filename}"\r\nContent-Type: {image["mime"]}\r\n\r\n'.encode()
        + raw + f'\r\n--{boundary}\r\nContent-Disposition: form-data; name="type"\r\n\r\ninput\r\n--{boundary}--\r\n'.encode()
    )
    request = urllib.request.Request(COMFY + '/upload/image', data=body, headers={'Content-Type': 'multipart/form-data; boundary=' + boundary})
    with OPENER.open(request, timeout=45) as response:
        result = json.load(response)
    return '/'.join(x for x in [result.get('subfolder', ''), result['name']] if x)

def build_workflow(data, image_names):
    return workflows.build(data, image_names)

def request_summary(data, graph, seed):
    return workflows.summary(data, graph, seed)


def save_jobs():
    # Atomic replacement prevents partial JSON if the service is restarted.
    temporary = JOBS_PATH.with_suffix('.tmp')
    temporary.write_text(json.dumps(JOBS, ensure_ascii=False, indent=2), encoding='utf-8')
    temporary.replace(JOBS_PATH)

def submit_generation(data, preview_only=False):
    request_id = data.get('request_id', '')
    if not isinstance(request_id, str) or not re.fullmatch(r'[a-zA-Z0-9-]{16,64}', request_id):
        raise ValueError('Identificador de envio inválido.')
    if preview_only:
        if not isinstance(data.get('settings', {}), dict):
            raise ValueError('Configurações inválidas.')
        data = {**data, 'settings': {**data.get('settings', {}), 'refine_prompt': True}}
    with JOBS_LOCK:
        for pid, job in JOBS.items():
            if job.get('request_id') == request_id:
                return {'prompt_id': pid, 'seed': job['seed'], 'request': job.get('request'), 'kind': job.get('kind', 'image')}
        images = data.get('images', [])
        if not isinstance(images, list) or len(images) > 10:
            raise ValueError('Use até 10 referências.')
        # Validate parameters before uploading or submitting anything.
        profile, config, seed = workflows.validate(data, ['validation'] if data.get('mode') == 'edit' and images else [])
        if preview_only and profile != 'qwen21':
            raise ValueError('Selecione Qwen 2.1 completo para aprimorar o prompt.')
        data = {**data, 'seed': seed}
        image_names = [upload_image(image) for image in images] if data.get('mode') == 'edit' else []
        refining = preview_only or config['refine_prompt']
        graph, seed = workflows.build_refiner(data, image_names) if refining else build_workflow(data, image_names)
        result = comfy('/prompt', {'prompt': graph, 'client_id': COMFY_CLIENT_ID})
        pid = result.get('prompt_id')
        if not pid:
            raise ValueError('O ComfyUI não retornou um identificador de geração.')
        summary = request_summary(data, graph, seed)
        safe_data = {k: v for k, v in data.items() if k != 'images'}
        safe_data['images'] = [{k: image.get(k, '') for k in ('name', 'role')} for image in images]
        JOBS[pid] = {'request_id': request_id, 'seed': seed, 'mode': data['mode'], 'request': summary,
                     'kind': 'refine' if refining else 'image', 'intent': 'preview' if preview_only else 'generate',
                     'image_names': image_names, 'data': safe_data}
        save_jobs()
        return {'prompt_id': pid, 'seed': seed, 'request': summary, 'kind': JOBS[pid]['kind']}


def continue_generation(parent):
    if parent not in JOBS or JOBS[parent].get('kind') != 'refine' or JOBS[parent].get('intent') != 'generate':
        raise ValueError('Aprimoramento não corresponde a um pedido de geração.')
    status = generation_status(parent)
    if status['status'] != 'completed':
        raise ValueError('Aguarde o aprimoramento terminar antes de continuar.')
    with JOBS_LOCK:
        job = JOBS[parent]
        if job.get('cancel_requested'):
            raise ValueError('Este pedido foi cancelado. Envie um novo pedido para gerar outra imagem.')
        if job.get('child'):
            child = job['child']
            return {'prompt_id': child, 'seed': JOBS[child]['seed'], 'request': JOBS[child]['request']}
        original = job['data']
        data = {**original, 'prompt': status['refined_prompt'],
                'settings': {**original.get('settings', {}), 'refine_prompt': False}}
        graph, seed = build_workflow(data, job['image_names'])
        result = comfy('/prompt', {'prompt': graph, 'client_id': COMFY_CLIENT_ID})
        pid = result.get('prompt_id')
        if not pid:
            raise ValueError('ComfyUI não retornou identificador.')
        summary = request_summary(data, graph, seed)
        summary.update(original_prompt=original['prompt'].strip(), effective_prompt=data['prompt'],
                       refine_prompt=True, refiner=job['request'].get('refiner', {}))
        JOBS[pid] = {'request_id': original['request_id'] + ':image', 'seed': seed, 'mode': data['mode'],
                     'request': summary, 'kind': 'image', 'image_names': job['image_names'], 'parent': parent}
        job['child'] = pid
        save_jobs()
        return {'prompt_id': pid, 'seed': seed, 'request': summary, 'kind': 'image'}

def cancel_generation(pid):
    with JOBS_LOCK:
        if pid not in JOBS:
            raise ValueError('Geração não encontrada neste Studio.')
        root = JOBS[pid].get('parent', pid)
        targets = [root]
        child = JOBS[root].get('child')
        if child and child in JOBS:
            targets.append(child)
        # Persist first so a concurrent continuation cannot start an image.
        for target in targets:
            JOBS[target]['cancel_requested'] = True
        save_jobs()
        comfy('/queue', {'delete': targets})
        for target in targets:
            # Installed ComfyUI supports prompt-specific interruption.
            comfy('/interrupt', {'prompt_id': target})
        for target in targets:
            JOBS[target]['cancelled'] = True
        save_jobs()
        return {'status': 'cancelled', 'prompt_id': pid}


def extract_refined_prompt(text, original=''):
    if not isinstance(text, str):
        raise ValueError('O aprimorador não retornou texto. O prompt original foi preservado.')
    # Some Qwen templates open reasoning before generation. TextGenerate can
    # return a closing tag without the opening tag; only the final answer after
    # the last closing tag belongs in the image prompt.
    closing_tags = list(re.finditer(r'</think>', text, flags=re.IGNORECASE))
    if closing_tags:
        text = text[closing_tags[-1].end():]
    if re.search(r'</?think\b', text, flags=re.IGNORECASE):
        raise ValueError('O aprimorador terminou durante o raciocínio, sem resposta final. Aumente o limite de tokens ou desligue Thinking. O prompt original foi preservado.')
    text = text.strip()
    if not text:
        raise ValueError('O aprimorador não retornou uma resposta final. Aumente o limite de tokens ou desligue Thinking. O prompt original foi preservado.')
    if len(text) > 12000:
        raise ValueError('A resposta final do aprimorador ultrapassou 12.000 caracteres. O prompt original foi preservado.')
    if text != original.strip() and re.match(r'^(?:\{|\[|```)', text):
        raise ValueError('O aprimorador retornou JSON ou um bloco de código em vez do prompt em texto. O prompt original foi preservado. Tente novamente com Thinking ligado.')
    if len(original.split()) >= 6 and len(text.split()) < 4:
        raise ValueError('O aprimorador retornou uma resposta incompleta. Aumente o limite de tokens ou desligue Thinking. O prompt original foi preservado.')
    return text


def generation_status(pid):
    if pid not in JOBS:
        raise ValueError('Geração não encontrada neste Studio.')
    if JOBS[pid].get('cancel_requested'):
        return {'status': 'cancelled' if JOBS[pid].get('cancelled') else 'cancelling',
                'kind': JOBS[pid].get('kind', 'image'), 'seed': JOBS[pid]['seed']}
    history = comfy('/history/' + urllib.parse.quote(pid, safe='')).get(pid)
    if history:
        state = history.get('status', {})
        if state.get('status_str') == 'error':
            errors = [payload.get('exception_message', '') for kind, payload in state.get('messages', []) if kind == 'execution_error']
            return {'status': 'error', 'error': 'Falha no ComfyUI: ' + ('; '.join(errors) or 'consulte o log do workflow.')[:1200]}
        if JOBS[pid].get('kind') == 'refine':
            text = history.get('outputs', {}).get('34', {}).get('text', [])
            text = text[0] if isinstance(text, list) and text else text if isinstance(text, str) else ''
            original = JOBS[pid].get('request', {}).get('prompt', '')
            try:
                text = extract_refined_prompt(text, original)
            except ValueError as error:
                return {'status': 'error', 'error': str(error)}
            return {'status': 'completed', 'kind': 'refine', 'intent': JOBS[pid]['intent'], 'seed': JOBS[pid]['seed'],
                    'refined_prompt': text, 'request': JOBS[pid]['request']}
        images = [im for out in history.get('outputs', {}).values() for im in out.get('images', []) if im.get('type') == 'output']
        if images:
            return {'status': 'completed', 'seed': JOBS[pid]['seed'], 'images': images, 'request': JOBS[pid].get('request'),
                    'has_reference': bool(JOBS[pid].get('image_names'))}
        return {'status': 'error', 'error': 'O workflow terminou sem retornar uma imagem.'}
    queue = comfy('/queue')
    if any(item[1] == pid for item in queue.get('queue_running', [])):
        return {'status': 'running', 'seed': JOBS[pid]['seed'], 'kind': JOBS[pid].get('kind', 'image'),
                'progress': PROGRESS.snapshot(pid)}
    pending = [item[1] for item in queue.get('queue_pending', [])]
    return {'status': 'queued', 'position': pending.index(pid) + 1 if pid in pending else None, 'seed': JOBS[pid]['seed'], 'kind': JOBS[pid].get('kind', 'image')}

def allowed_origin(origin, port, hosts):
    if not origin:
        return True
    try:
        parsed = urllib.parse.urlsplit(origin)
        return parsed.scheme == 'http' and parsed.hostname in hosts and (parsed.port or 80) == port and not parsed.username
    except ValueError:
        return False

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def send_head(self):
        if self.path in PUBLIC_FILES:
            # Reloads must read the current editor, including its inline code.
            if 'If-Modified-Since' in self.headers:
                del self.headers['If-Modified-Since']
        return super().send_head()

    def end_headers(self):
        if self.path in PUBLIC_FILES:
            self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, fmt, *args):
        # Never log prompt text or payloads.
        super().log_message(fmt, *args)

    def client_allowed(self):
        address = ipaddress.ip_address(self.client_address[0])
        return address.is_loopback or any(address in network for network in self.server.allowed_networks)

    def do_HEAD(self):
        if not self.client_allowed():
            self.send_error(403)
        elif self.path == '/' or self.path in PUBLIC_FILES:
            if self.path == '/':
                self.path = '/KPPB_Image_Studio_v5_1.html'
            super().do_HEAD()
        else:
            self.send_error(404)

    def json_response(self, status, body):
        encoded = json.dumps(body, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(encoded)))
        self.end_headers()
        try:
            self.wfile.write(encoded)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self):
        if not self.client_allowed():
            self.json_response(403, {'error': 'Acesso permitido somente na rede local configurada.'})
            return
        if self.path == '/api/jobs':
            jobs = [{'prompt_id': pid, **{k: job[k] for k in ('mode', 'seed')}, 'kind': job.get('kind', 'image'),
                     'workflow': job.get('request', {}).get('workflow', 'Qwen Image 2.1 Turbo')} for pid, job in reversed(list(JOBS.items()))][:20]
            self.json_response(200, {'jobs': jobs})
        elif self.path == '/api/comfy':
            try:
                comfy('/system_stats')
                self.json_response(200, {'available': True, **workflows.options()})
            except (ValueError, urllib.error.URLError, OSError):
                self.json_response(503, {'available': False, 'error': 'Abra o ComfyUI em 127.0.0.1:8188.'})
        elif self.path.startswith('/api/job/'):
            try:
                pid = self.path.removeprefix('/api/job/')
                self.json_response(200, generation_status(pid))
            except ValueError as error:
                self.json_response(400, {'error': str(error)})
            except (urllib.error.URLError, OSError):
                self.json_response(503, {'error': 'Sem conexão com o ComfyUI. A geração pode continuar no servidor.'})
        elif self.path.startswith('/api/image?') or self.path.startswith('/api/reference?'):
            try:
                params = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
                pid = params.get('job', [''])[0]
                index = int(params.get('index', ['0'])[0])
                if self.path.startswith('/api/reference?'):
                    name = JOBS[pid]['image_names'][index]
                    subfolder, _, filename = name.rpartition('/')
                    image = {'filename': filename, 'subfolder': subfolder, 'type': 'input'}
                else:
                    status = generation_status(pid)
                    image = status.get('images', [])[index]
                query = urllib.parse.urlencode({k: image.get(k, '') for k in ('filename', 'subfolder', 'type')})
                with OPENER.open(COMFY + '/view?' + query, timeout=30) as response:
                    raw = response.read()
                    mime = response.headers.get('Content-Type', 'image/png')
                self.send_response(200)
                self.send_header('Content-Type', mime)
                self.send_header('Content-Length', str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)
            except (ValueError, IndexError, KeyError, urllib.error.URLError, OSError):
                self.json_response(404, {'error': 'Imagem indisponível.'})
        elif self.path == '/' or self.path in PUBLIC_FILES:
            if self.path == '/':
                self.path = '/KPPB_Image_Studio_v5_1.html'
            super().do_GET()
        else:
            self.json_response(404, {'error': 'Rota desconhecida.'})

    def do_POST(self):
        if not self.client_allowed():
            self.json_response(403, {'error': 'Acesso permitido somente na rede local configurada.'})
            return
        if self.path not in ('/api/generate', '/api/refine', '/api/continue', '/api/cancel'):
            self.json_response(404, {'error': 'Rota desconhecida.'})
            return
        origin = self.headers.get('Origin')
        if not allowed_origin(origin, self.server.server_port, self.server.allowed_hosts):
            self.json_response(403, {'error': 'Abra a ferramenta pelo endereço local do Studio.'})
            return
        try:
            size = int(self.headers.get('Content-Length', '0'))
            limit = 80 * 1024 * 1024
            if size < 1 or size > limit:
                raise ValueError('Pedido vazio ou muito grande.')
            data = json.loads(self.rfile.read(size))
            if not isinstance(data, dict):
                raise ValueError('Pedido inválido.')
            if self.path in ('/api/continue', '/api/cancel'):
                parent = data.get('prompt_id')
                if not isinstance(parent, str):
                    raise ValueError('Identificador inválido.')
                result = cancel_generation(parent) if self.path == '/api/cancel' else continue_generation(parent)
            else:
                result = submit_generation(data, preview_only=self.path == '/api/refine')
            self.json_response(200, result)
        except (ValueError, TypeError, json.JSONDecodeError) as error:
            self.json_response(400, {'error': str(error)})
        except (urllib.error.URLError, OSError) as error:
            self.json_response(503, {'error': 'O ComfyUI não respondeu. Abra-o e tente novamente.'})
        except Exception:
            self.json_response(500, {'error': 'Falha no envio ao ComfyUI. O prompt original foi preservado.'})

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8770)
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--lan-ip', action='append', default=[])
    parser.add_argument('--allow-network', action='append', default=[])
    arguments = parser.parse_args()
    server = ThreadingHTTPServer((arguments.host, arguments.port), Handler)
    server.allowed_hosts = {'127.0.0.1', 'localhost', *arguments.lan_ip}
    server.allowed_networks = [ipaddress.ip_network(n, strict=False) for n in arguments.allow_network]
    print(f'KPPB Image Studio: http://127.0.0.1:{arguments.port}/', flush=True)
    for address in arguments.lan_ip:
        print(f'Rede local, sem senha: http://{address}:{arguments.port}/', flush=True)
    PROGRESS.start()
    try:
        server.serve_forever()
    finally:
        PROGRESS.stop_event.set()
