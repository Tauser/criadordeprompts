"""Machine readings for the Diagnostics page: NVIDIA GPU (via nvidia-smi, when present), disk and data folder size.
Every reading is optional and cached for a short time, so a page polling every few seconds costs almost nothing."""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path

GPU_FIELDS = ('name', 'utilization.gpu', 'temperature.gpu', 'power.draw', 'power.limit', 'memory.used', 'memory.total')


def _number(value: str) -> float | None:
    try:
        return float(value)
    except ValueError:                   # "[N/A]", "[Not Supported]"
        return None


def parse_gpus(output: str) -> list[dict]:
    gpus = []
    for line in output.strip().splitlines():
        parts = [p.strip() for p in line.split(',')]
        if len(parts) != len(GPU_FIELDS):
            continue
        name, util, temp, draw, limit, used, total = parts
        mib = 1024 * 1024
        gpus.append({'name': name, 'utilization': _number(util), 'temperature': _number(temp),
                     'power_draw': _number(draw), 'power_limit': _number(limit),
                     'memory_used': int(_number(used) * mib) if _number(used) is not None else None,
                     'memory_total': int(_number(total) * mib) if _number(total) is not None else None})
    return gpus


class SystemMonitor:
    def __init__(self, data_dir: Path, gpu_ttl: float = 2.0, folder_ttl: float = 60.0):
        self.data_dir = Path(data_dir)
        self.gpu_ttl, self.folder_ttl = gpu_ttl, folder_ttl
        self._lock = threading.Lock()
        self._gpu: tuple[float, list[dict] | None] = (0.0, None)
        self._folder: tuple[float, int | None] = (0.0, None)
        self._smi = shutil.which('nvidia-smi')

    def gpus(self) -> list[dict] | None:
        """None when nvidia-smi is missing or does not answer."""
        with self._lock:
            at, cached = self._gpu
            if time.monotonic() - at < self.gpu_ttl:
                return cached
            value = self._read_gpus()
            self._gpu = (time.monotonic(), value)
            return value

    def _read_gpus(self) -> list[dict] | None:
        if not self._smi:
            return None
        try:
            result = subprocess.run([self._smi, f'--query-gpu={",".join(GPU_FIELDS)}', '--format=csv,noheader,nounits'],
                                    capture_output=True, text=True, timeout=3,
                                    creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0) if sys.platform == 'win32' else 0)
        except (OSError, subprocess.SubprocessError):
            return None
        return parse_gpus(result.stdout) if result.returncode == 0 else None

    def disk(self) -> dict:
        usage = shutil.disk_usage(self.data_dir)
        return {'path': str(self.data_dir.anchor or self.data_dir), 'total': usage.total, 'free': usage.free,
                'studio_bytes': self.folder_size()}

    def folder_size(self) -> int | None:
        with self._lock:
            at, cached = self._folder
            if cached is not None and time.monotonic() - at < self.folder_ttl:
                return cached
        total = 0
        for root, _dirs, files in os.walk(self.data_dir):
            for name in files:
                try:
                    total += os.path.getsize(os.path.join(root, name))
                except OSError:
                    pass
        with self._lock:
            self._folder = (time.monotonic(), total)
        return total
