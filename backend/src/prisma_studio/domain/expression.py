"""Facial expressions measured by the face detector (MediaPipe blendshapes, 0 to 1), told in words for the image model.

Measured on person swaps: asking the edit model for "the same expression as <image2>" does not undo the smile or the
open mouth the identity reference brings; naming the expression in words does, and the same measure confirms it.
"""
from __future__ import annotations

# The blendshapes read from the detector output; the others are not used.
NAMES = ('mouthSmileLeft', 'mouthSmileRight', 'jawOpen', 'eyeBlinkLeft', 'eyeBlinkRight', 'browInnerUp')

SMILE_BROAD, SMILE_SLIGHT = 0.6, 0.25
MOUTH_OPEN, MOUTH_PARTED = 0.35, 0.12
EYES_CLOSED = 0.55
BROWS_RAISED = 0.5
SMILE_DIFFERENCE, MOUTH_DIFFERENCE = 0.4, 0.3       # beyond these the result's expression is not the scene's


def _values(shapes: dict) -> tuple[float, float, float, float]:
    smile = (shapes.get('mouthSmileLeft', 0) + shapes.get('mouthSmileRight', 0)) / 2
    blink = (shapes.get('eyeBlinkLeft', 0) + shapes.get('eyeBlinkRight', 0)) / 2
    return smile, shapes.get('jawOpen', 0), blink, shapes.get('browInnerUp', 0)


def describe(shapes: dict | None) -> str | None:
    """A noun phrase for "the person ... has ___", or None when nothing was measured."""
    if not shapes:
        return None
    smile, jaw, blink, brows = _values(shapes)
    if jaw >= MOUTH_OPEN:
        phrase = 'a laugh with the mouth open' if smile >= SMILE_SLIGHT else 'the mouth open'
    elif smile >= SMILE_BROAD:
        phrase = ('a broad smile with the lips slightly parted' if jaw >= MOUTH_PARTED
                  else 'a broad smile, the mouth not wide open')
    elif smile >= SMILE_SLIGHT:
        phrase = 'a slight smile with the lips closed'
    else:
        phrase = 'a calm, serious expression with the lips closed and relaxed, no smile and no teeth showing'
    if blink >= EYES_CLOSED:
        phrase += ', the eyes closed'
    if brows >= BROWS_RAISED:
        phrase += ', the eyebrows raised'
    return phrase


def differs(scene: dict | None, result: dict | None) -> bool:
    """True when the result's measured expression is clearly not the scene's (smile or open mouth)."""
    if not scene or not result:
        return False
    a, b = _values(scene), _values(result)
    return abs(a[0] - b[0]) > SMILE_DIFFERENCE or abs(a[1] - b[1]) > MOUTH_DIFFERENCE
