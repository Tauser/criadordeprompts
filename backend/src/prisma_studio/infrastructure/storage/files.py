"""Content-addressed image storage with decoding checks and size normalization."""
from __future__ import annotations

import hashlib
import io
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, UnidentifiedImageError

MAX_BYTES = 25 * 1024 * 1024
FORMATS = {'PNG': 'image/png', 'JPEG': 'image/jpeg', 'WEBP': 'image/webp'}


@dataclass(frozen=True)
class StoredFile:
    hash: str
    mime: str
    width: int
    height: int
    size: int


class FileStore:
    def __init__(self, root: Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def path(self, file_hash: str) -> Path:
        if len(file_hash) != 64 or any(c not in '0123456789abcdef' for c in file_hash):
            raise ValueError('Identificador de arquivo inválido.')
        return self.root / file_hash[:2] / file_hash

    def put(self, data: bytes) -> StoredFile:
        if not data or len(data) > MAX_BYTES:
            raise ValueError('Use imagens de até 25 MB.')
        try:
            with Image.open(io.BytesIO(data)) as image:
                image.verify()
            with Image.open(io.BytesIO(data)) as image:
                fmt, width, height = image.format, image.width, image.height
        except (UnidentifiedImageError, OSError, SyntaxError) as error:
            raise ValueError('O arquivo não é uma imagem válida.') from error
        if fmt not in FORMATS:
            raise ValueError('Use PNG, JPG ou WEBP.')
        digest = hashlib.sha256(data).hexdigest()
        target = self.path(digest)
        if not target.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(dir=target.parent, delete=False) as handle:
                handle.write(data)
                temporary = handle.name
            os.replace(temporary, target)
        return StoredFile(digest, FORMATS[fmt], width, height, len(data))

    def delete(self, file_hash: str) -> None:
        self.path(file_hash).unlink(missing_ok=True)

    def read(self, file_hash: str) -> bytes:
        return self.path(file_hash).read_bytes()


def fit_multiple_of_32(width: int, height: int, max_pixels: int) -> tuple[int, int]:
    scale = min(1.0, (max_pixels / (width * height)) ** 0.5)
    w = max(32, int(width * scale) // 32 * 32)
    h = max(32, int(height * scale) // 32 * 32)
    return w, h


def normalized_png(data: bytes, size: tuple[int, int], mask: bool = False) -> bytes:
    """Resize to an exact size and return PNG bytes; masks become single-channel white-on-black."""
    with Image.open(io.BytesIO(data)) as image:
        if mask:
            source = image.getchannel('A') if 'A' in image.getbands() and image.getextrema()[-1][0] < 255 \
                else image.convert('L')
            out = source.resize(size, Image.Resampling.NEAREST).point(lambda v: 255 if v >= 128 else 0)
        else:
            out = image.convert('RGB').resize(size, Image.Resampling.LANCZOS)
        buffer = io.BytesIO()
        out.save(buffer, format='PNG')
        return buffer.getvalue()
