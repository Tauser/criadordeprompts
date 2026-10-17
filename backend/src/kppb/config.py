"""Runtime configuration from environment variables and command-line flags."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[3]


@dataclass(frozen=True)
class Config:
    data_dir: Path = field(default_factory=lambda: Path(os.environ.get('KPPB_DATA_DIR', PROJECT_ROOT / 'data')))
    comfy_url: str = field(default_factory=lambda: os.environ.get('KPPB_COMFY_URL', 'http://127.0.0.1:8188'))
    catalog_path: Path = field(default_factory=lambda: PROJECT_ROOT / 'catalog' / 'defaults.json')
    frontend_dir: Path = field(default_factory=lambda: PROJECT_ROOT / 'frontend' / 'dist')
    token: str | None = field(default_factory=lambda: os.environ.get('KPPB_TOKEN') or None)
    start_workers: bool = True
