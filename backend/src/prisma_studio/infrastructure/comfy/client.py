"""The only module that speaks ComfyUI's HTTP protocol."""
from __future__ import annotations

import uuid
from dataclasses import dataclass

import httpx


class ComfyUnavailable(RuntimeError):
    """Network-level failure: the outcome of the call is unknown."""


class ComfyNotSent(ComfyUnavailable):
    """The connection was never established, so ComfyUI cannot have received the request."""


class ComfyRejected(ValueError):
    """ComfyUI answered and refused the request."""


@dataclass(frozen=True)
class JobState:
    status: str                      # pending | in_progress | completed | failed | cancelled | missing
    start_time: float | None = None
    end_time: float | None = None
    error: str | None = None


def _seconds(value):
    """ComfyUI reports timestamps in milliseconds."""
    return value / 1000 if isinstance(value, (int, float)) else None


class ComfyClient:
    def __init__(self, base_url: str = 'http://127.0.0.1:8188', client_id: str | None = None,
                 http: httpx.Client | None = None, timeout: float = 30):
        self.base_url = base_url.rstrip('/')
        self.client_id = client_id or 'prisma-studio-' + uuid.uuid4().hex[:8]
        self.http = http or httpx.Client(timeout=timeout, trust_env=False)

    def _call(self, method: str, path: str, **kwargs) -> httpx.Response:
        try:
            response = self.http.request(method, self.base_url + path, **kwargs)
        except (httpx.ConnectError, httpx.ConnectTimeout) as error:
            raise ComfyNotSent(f'ComfyUI indisponível: {error.__class__.__name__}') from error
        except httpx.HTTPError as error:
            raise ComfyUnavailable(f'ComfyUI indisponível: {error.__class__.__name__}') from error
        if response.status_code >= 500 or response.status_code == 408:
            raise ComfyUnavailable(f'ComfyUI temporariamente indisponível: HTTP {response.status_code}.')
        return response

    @staticmethod
    def _decode(response: httpx.Response) -> dict:
        try:
            data = response.json() if response.content.strip() else {}
        except ValueError as error:
            raise ComfyUnavailable('O ComfyUI devolveu uma resposta JSON inválida.') from error
        if not isinstance(data, dict):
            raise ComfyUnavailable('O ComfyUI devolveu uma resposta fora do formato esperado.')
        return data

    def _json(self, method: str, path: str, **kwargs):
        response = self._call(method, path, **kwargs)
        if response.status_code >= 400:
            raise ComfyRejected(f'ComfyUI recusou {path}: {response.text[:1500]}')
        return self._decode(response)

    def system_stats(self) -> dict:
        return self._json('GET', '/system_stats')

    def object_info(self) -> dict:
        return self._json('GET', '/object_info')

    def submit(self, graph: dict, prompt_id: str) -> str:
        """Queue a graph under a client-chosen UUID, so an unconfirmed submission can be looked up."""
        response = self._call('POST', '/prompt', json={'prompt': graph, 'client_id': self.client_id,
                                                      'prompt_id': prompt_id})
        # A server/proxy error or an invalid answer does not prove that the graph was refused.
        # Preserve the chosen ID and reconcile it instead of failing the run or resending it.
        if 400 <= response.status_code < 500:
            raise ComfyRejected(f'ComfyUI recusou /prompt: {response.text[:1500]}')
        data = self._decode(response)
        if not data.get('prompt_id'):
            raise ComfyUnavailable('O ComfyUI não confirmou o identificador do trabalho enviado.')
        if data.get('node_errors'):
            raise ComfyRejected(f'Workflow inválido: {data["node_errors"]}')
        if data['prompt_id'] != prompt_id:
            raise ComfyUnavailable('O ComfyUI respondeu com um identificador diferente do enviado.')
        return prompt_id

    def job(self, prompt_id: str) -> JobState:
        response = self._call('GET', f'/api/jobs/{prompt_id}')
        if response.status_code == 404:
            return JobState('missing')
        if response.status_code >= 400:
            raise ComfyRejected(f'Consulta recusada: {response.text[:500]}')
        data = self._decode(response)
        error = data.get('execution_error')
        message = error.get('exception_message') if isinstance(error, dict) else None
        return JobState(data.get('status', 'missing'), _seconds(data.get('execution_start_time')),
                        _seconds(data.get('execution_end_time')), message)

    def outputs(self, prompt_id: str) -> dict:
        return self._json('GET', f'/history/{prompt_id}').get(prompt_id, {}).get('outputs', {})

    def cancel(self, prompt_id: str) -> bool:
        return bool(self._json('POST', f'/api/jobs/{prompt_id}/cancel').get('cancelled'))

    def upload(self, data: bytes, filename: str, mime: str) -> str:
        files = {'image': (filename, data, mime)}
        result = self._json('POST', '/upload/image', files=files, data={'type': 'input', 'overwrite': 'true'})
        return '/'.join(x for x in (result.get('subfolder', ''), result['name']) if x)

    def view(self, filename: str, subfolder: str, kind: str) -> bytes:
        response = self._call('GET', '/view', params={'filename': filename, 'subfolder': subfolder, 'type': kind})
        if response.status_code >= 400:
            raise ComfyRejected('Arquivo indisponível no ComfyUI.')
        return response.content
