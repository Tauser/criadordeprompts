"""Face detail pass: small faces are cropped, redrawn at full resolution with low denoise and pasted back.

The crop is sampled from its own pixels (img2img), not sent as a reference image: an edit model given the crop as
reference copies it, blur and uneven eyes included, at any denoise. Low denoise is what preserves identity.
"""
from __future__ import annotations

DENOISE = 0.45               # 0.3 barely changes the eyes; 0.6 starts to smooth and rejuvenate the face
MIN_PEOPLE = 2               # automatic mode: on when the run expects this many people or more
MAX_FACE = 320               # faces larger than this (pixels) already have enough resolution and are left alone
PHOTO_STYLE = ('natural photographic detail: real skin texture with visible pores, realistic hair and '
               'true-to-life colors')


def enabled(choice: bool | None, participants: int | None) -> bool:
    """None means automatic: group pictures shrink each face, so the pass pays off from two people on."""
    return choice if choice is not None else (participants or 0) >= MIN_PEOPLE


def prompt(style: str | None = None) -> str:
    """Text for the face crop. `style` is the run's own style sentence, used when it names no reference image."""
    lines = ["A close-up of a person's face, in sharp focus, with " + PHOTO_STYLE + '.',
             'Clear eyes with defined irises and natural catchlights, a well-formed nose and mouth.',
             "The two eyes match in size, shape and iris color, sit level with each other and look in the same "
             'direction.']
    if style and '<image' not in style:
        lines.append(style)
    return '\n'.join(lines)
