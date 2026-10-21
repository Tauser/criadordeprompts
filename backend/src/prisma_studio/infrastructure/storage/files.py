"""Content-addressed image storage with decoding checks and size normalization."""
from __future__ import annotations

import hashlib
import io
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageOps, UnidentifiedImageError

MAX_BYTES = 25 * 1024 * 1024
MAX_RESULT_BYTES = 256 * 1024 * 1024
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

    def put(self, data: bytes, limit: int = MAX_BYTES) -> StoredFile:
        """`limit` applies to uploads; results the Studio produces itself (a full-size PNG) may pass a larger one."""
        if not data or len(data) > limit:
            raise ValueError(f'Use imagens de até {limit // (1024 * 1024)} MB.')
        try:
            with Image.open(io.BytesIO(data)) as image:
                image.verify()
            with Image.open(io.BytesIO(data)) as image:
                fmt = image.format
                width, height = _oriented(image)
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


SWAPPED_ORIENTATIONS = {5, 6, 7, 8}       # EXIF orientations that turn the picture 90 degrees


def _oriented(image: Image.Image) -> tuple[int, int]:
    """Width and height as displayed, honouring the EXIF orientation like browsers and ComfyUI do."""
    try:
        orientation = image.getexif().get(0x0112, 1)
    except Exception:  # noqa: BLE001 - a broken EXIF block must not reject the image
        orientation = 1
    return (image.height, image.width) if orientation in SWAPPED_ORIENTATIONS else (image.width, image.height)


def oriented_size(data: bytes) -> tuple[int, int]:
    with Image.open(io.BytesIO(data)) as image:
        return _oriented(image)


def fit_multiple_of_32(width: int, height: int, max_pixels: int) -> tuple[int, int]:
    scale = min(1.0, (max_pixels / (width * height)) ** 0.5)
    w = max(32, int(width * scale) // 32 * 32)
    h = max(32, int(height * scale) // 32 * 32)
    return w, h


def _binary_mask(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    """White (255) where the user painted, black elsewhere, at `size`."""
    source = image.getchannel('A') if 'A' in image.getbands() and image.getextrema()[-1][0] < 255 \
        else image.convert('L')
    return source.resize(size, Image.Resampling.NEAREST).point(lambda v: 255 if v >= 128 else 0)


def normalized_png(data: bytes, size: tuple[int, int], mask: bool = False) -> bytes:
    """Resize to an exact size and return PNG bytes; masks become single-channel white-on-black."""
    with Image.open(io.BytesIO(data)) as image:
        if mask:
            out = _binary_mask(image, size)
        else:
            out = ImageOps.exif_transpose(image).convert('RGB').resize(size, Image.Resampling.LANCZOS)
        buffer = io.BytesIO()
        out.save(buffer, format='PNG')
        return buffer.getvalue()


def composite_on_original(original: bytes, generated: bytes, mask: bytes, feather: int = 0) -> bytes:
    """Put the generated picture back into the original photo through the drawn mask.

    The result has the original's size and orientation. Outside the drawn area the weight is exactly zero, so
    those pixels are the original's, byte for byte once decoded; the soft transition lies inside the area."""
    with Image.open(io.BytesIO(original)) as image:
        base = ImageOps.exif_transpose(image).convert('RGB')
    with Image.open(io.BytesIO(generated)) as image:
        new = image.convert('RGB')
        if new.size != base.size:
            new = new.resize(base.size, Image.Resampling.LANCZOS)
    with Image.open(io.BytesIO(mask)) as image:
        weight = _binary_mask(image, base.size)
    if feather > 0:
        soft = weight.filter(ImageFilter.GaussianBlur(feather / 2))
        weight = ImageChops.darker(soft, weight)          # never above the drawn mask: zero stays zero
    out = Image.composite(new, base, weight)
    buffer = io.BytesIO()
    out.save(buffer, format='PNG')
    return buffer.getvalue()


def face_crop_box(box: dict, image_size: tuple[int, int], scale: float = 1.6) -> tuple[int, int, int]:
    """Square (left, top, side) around a detected face, `scale` times its larger side, kept inside the picture."""
    width, height = image_size
    side = min(round(max(box['width'], box['height']) * scale), width, height)
    cx, cy = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
    left = min(max(0, round(cx - side / 2)), width - side)
    top = min(max(0, round(cy - side / 2)), height - side)
    return left, top, side


def bust_box(box: dict, image_size: tuple[int, int]) -> tuple[int, int, int, int]:
    """(left, top, right, bottom) of the head, neck and top of the shoulders around a detected face. Tight on
    purpose: a person-swap reference that shows the arms or the pose gets copied into the scene."""
    width, height = image_size
    cx = box['x'] + box['width'] / 2
    half = box['width'] * 1.5
    left, right = max(0, round(cx - half)), min(width, round(cx + half))
    top = max(0, round(box['y'] - box['height'] * 0.6))
    bottom = min(height, round(box['y'] + box['height'] * 2.0))
    return left, top, right, bottom


def bust_png(data: bytes, crop: tuple[int, int, int, int], shortest: int = 512, longest: int = 1024) -> bytes:
    """The crop as PNG, scaled so its shorter side is at least `shortest` and its longer side at most `longest`."""
    with Image.open(io.BytesIO(data)) as image:
        out = ImageOps.exif_transpose(image).convert('RGB').crop(crop)
    scale = max(shortest / min(out.size), 1.0)
    scale = min(scale, longest / max(out.size))
    if abs(scale - 1.0) > 0.01:
        out = out.resize((max(1, round(out.width * scale)), max(1, round(out.height * scale))), Image.Resampling.LANCZOS)
    buffer = io.BytesIO()
    out.save(buffer, format='PNG')
    return buffer.getvalue()


def crop_square(data: bytes, crop: tuple[int, int, int], size: int) -> bytes:
    left, top, side = crop
    with Image.open(io.BytesIO(data)) as image:
        out = ImageOps.exif_transpose(image).convert('RGB').crop((left, top, left + side, top + side))
    out = out.resize((size, size), Image.Resampling.LANCZOS)
    buffer = io.BytesIO()
    out.save(buffer, format='PNG')
    return buffer.getvalue()


def face_mask(side: int, box: dict, crop: tuple[int, int, int]) -> Image.Image:
    """Soft oval over the face inside a crop of `side` pixels; zero along the crop's edges."""
    left, top, _ = crop
    pad_x, pad_y = box['width'] * 0.12, box['height'] * 0.12
    oval = (box['x'] - left - pad_x, box['y'] - top - pad_y * 1.5,
            box['x'] - left + box['width'] + pad_x, box['y'] - top + box['height'] + pad_y)
    feather = max(2.0, side * 0.04)
    mask = Image.new('L', (side, side), 0)
    inset = feather * 1.2
    shrunk = (max(inset, oval[0]), max(inset, oval[1]), min(side - inset, oval[2]), min(side - inset, oval[3]))
    ImageDraw.Draw(mask).ellipse(shrunk, fill=255)
    return mask.filter(ImageFilter.GaussianBlur(feather / 2))


def paste_faces(data: bytes, faces: list[tuple[bytes, dict, tuple[int, int, int]]]) -> bytes:
    """Put each refined face crop back at its place and original size through a soft oval."""
    with Image.open(io.BytesIO(data)) as image:
        out = ImageOps.exif_transpose(image).convert('RGB')
    for face, box, crop in faces:
        left, top, side = crop
        with Image.open(io.BytesIO(face)) as image:
            patch = image.convert('RGB').resize((side, side), Image.Resampling.LANCZOS)
        region = out.crop((left, top, left + side, top + side))
        out.paste(Image.composite(patch, region, face_mask(side, box, crop)), (left, top))
    buffer = io.BytesIO()
    out.save(buffer, format='PNG')
    return buffer.getvalue()
