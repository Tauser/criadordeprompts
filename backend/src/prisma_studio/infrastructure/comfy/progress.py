"""WebSocket listener: current node, step progress and per-node timings for each prompt."""
from __future__ import annotations

import json
import threading
import time
from collections import OrderedDict

try:
    import websocket
except ImportError:  # pragma: no cover
    websocket = None


class ProgressTracker:
    def __init__(self, base_url: str, client_id: str, clock=time.time):
        self.url = base_url.replace('http://', 'ws://', 1).rstrip('/') + '/ws?clientId=' + client_id
        self.clock = clock
        self.lock = threading.Lock()
        self.records: OrderedDict[str, dict] = OrderedDict()
        self.connected = threading.Event()
        self.stop_event = threading.Event()
        self.thread: threading.Thread | None = None

    def start(self) -> None:
        if websocket is None or self.thread is not None:
            return
        self.thread = threading.Thread(target=self._run, name='comfy-progress', daemon=True)
        self.thread.start()

    def stop(self) -> None:
        self.stop_event.set()

    def _run(self) -> None:
        while not self.stop_event.is_set():
            connection = None
            try:
                connection = websocket.create_connection(self.url, timeout=5,
                                                         http_no_proxy=['127.0.0.1', 'localhost'])
                self.connected.set()
                while not self.stop_event.is_set():
                    try:
                        message = connection.recv()
                    except websocket.WebSocketTimeoutException:
                        continue
                    if not message:
                        break
                    if isinstance(message, str):
                        self.handle(json.loads(message))
            except (OSError, ValueError, websocket.WebSocketException):
                pass
            finally:
                self.connected.clear()
                if connection is not None:
                    connection.close()
            self.stop_event.wait(2)

    def handle(self, event: dict) -> None:
        data = event.get('data') if isinstance(event.get('data'), dict) else {}
        prompt_id = data.get('prompt_id')
        kind = event.get('type')
        if not isinstance(prompt_id, str) or kind not in ('execution_start', 'executing', 'progress',
                                                         'execution_cached', 'execution_success',
                                                         'execution_error', 'execution_interrupted'):
            return
        now = self.clock()
        with self.lock:
            record = self.records.setdefault(prompt_id, {'node': None, 'node_started': None, 'timings': {},
                                                         'cached': [], 'value': None, 'maximum': None})
            self.records.move_to_end(prompt_id)
            while len(self.records) > 256:
                self.records.popitem(last=False)
            if kind == 'execution_cached':
                record['cached'] = list(data.get('nodes', []))
            elif kind == 'executing':
                self._close_node(record, now)
                node = data.get('node')
                record.update(node=node, node_started=now if node is not None else None, value=None, maximum=None)
            elif kind == 'progress':
                value, maximum = data.get('value'), data.get('max')
                if isinstance(value, (int, float)) and isinstance(maximum, (int, float)) and maximum > 0:
                    record.update(value=min(value, maximum), maximum=maximum)
            elif kind in ('execution_success', 'execution_error', 'execution_interrupted'):
                self._close_node(record, now)
                record.update(node=None, node_started=None)

    @staticmethod
    def _close_node(record: dict, now: float) -> None:
        if record['node'] is not None and record['node_started'] is not None:
            timings = record['timings']
            timings[record['node']] = round(timings.get(record['node'], 0) + now - record['node_started'], 3)

    def snapshot(self, prompt_id: str) -> dict | None:
        with self.lock:
            record = self.records.get(prompt_id)
            if record is None:
                return None
            return {**record, 'timings': dict(record['timings']), 'live': self.connected.is_set()}
