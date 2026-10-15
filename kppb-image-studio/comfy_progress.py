"""Receive ComfyUI progress without exposing its port to LAN clients."""
from collections import OrderedDict
import json
import math
import threading

try:
    import websocket
except ImportError:
    websocket = None


class ComfyProgress:
    def __init__(self, url, client_id):
        self.url = url.replace('http://', 'ws://', 1) + '/ws?clientId=' + client_id
        self.lock = threading.Lock()
        self.connected = threading.Event()
        self.stop_event = threading.Event()
        self.thread = None
        self.jobs = OrderedDict()

    def start(self):
        if websocket is None or self.thread is not None:
            return
        self.thread = threading.Thread(target=self._listen, daemon=True, name='comfy-progress')
        self.thread.start()

    def _listen(self):
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

    def handle(self, event):
        data = event.get('data', {})
        if not isinstance(data, dict) or not isinstance(data.get('prompt_id'), str):
            return
        pid = data['prompt_id']
        kind = event.get('type')
        if kind not in ('execution_start', 'executing', 'progress', 'progress_state'):
            return
        with self.lock:
            if kind == 'execution_start':
                self.jobs[pid] = {'phase': 'preparing'}
            record = self.jobs.setdefault(pid, {'phase': 'preparing'})
            self.jobs.move_to_end(pid)
            while len(self.jobs) > 128:
                self.jobs.popitem(last=False)
            if kind == 'executing':
                self._node(record, data.get('node'))
            elif kind == 'progress':
                self._steps(record, data.get('node'), data.get('value'), data.get('max'))
            elif kind == 'progress_state':
                for node, state in data.get('nodes', {}).items():
                    if isinstance(state, dict) and state.get('state') == 'running':
                        self._node(record, node)
                        self._steps(record, node, state.get('value'), state.get('max'))

    @staticmethod
    def _node(record, node):
        phase = {'9': 'sampling', '10': 'decoding', '11': 'saving', '33': 'refining'}.get(str(node))
        if phase:
            record['phase'] = phase
        elif node is not None:
            record['phase'] = 'preparing'

    @staticmethod
    def _steps(record, node, value, maximum):
        if str(node) != '9':
            return
        if not isinstance(value, (int, float)) or not isinstance(maximum, (int, float)):
            return
        if not math.isfinite(value) or not math.isfinite(maximum) or maximum <= 0:
            return
        value = max(0, min(value, maximum))
        record.update(phase='sampling', value=value, maximum=maximum,
                      percent=round(100 * value / maximum, 1))

    def snapshot(self, pid):
        if not self.connected.is_set():
            return None
        with self.lock:
            return dict(self.jobs[pid]) if pid in self.jobs else None
