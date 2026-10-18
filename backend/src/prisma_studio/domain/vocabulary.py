"""Closed vocabularies shared by the request, the catalog and the compiler."""
from typing import Literal

Category = Literal['subject', 'face', 'body', 'skin', 'hair', 'wardrobe', 'environment', 'pose',
                   'expression', 'action', 'lighting', 'style', 'camera', 'framing']
CATEGORIES: tuple[str, ...] = ('subject', 'face', 'body', 'skin', 'hair', 'wardrobe', 'environment', 'pose',
                               'expression', 'action', 'lighting', 'style', 'camera', 'framing')
Intent = Literal['keep', 'set', 'transfer', 'free']
Posture = Literal['standing', 'seated', 'kneeling', 'all_fours', 'squatting', 'lying', 'supine', 'prone',
                  'side_lying', 'walking', 'running', 'any']
# 'lying' is the generic form of these postures, so it agrees with any one of them.
LYING_POSTURES = ('supine', 'prone', 'side_lying')
Gaze = Literal['camera', 'away', 'down', 'up', 'back', 'closed', 'any']
Orientation = Literal['front', 'back', 'side', 'three_quarter', 'any']   # where the body faces, seen from the camera
Support = Literal['floor', 'seat', 'bed', 'wall', 'table']
Framing = Literal['portrait', 'half', 'full', 'wide']
FRAMING_ORDER = {'portrait': 0, 'half': 1, 'full': 2, 'wide': 3}
Confirmation = Literal['adults_only', 'consent_or_fictional']

# Categories whose kept/transferred value belongs to a person (identity group).
PERSON_ASPECTS = ('subject', 'face', 'body', 'skin', 'hair', 'wardrobe', 'pose', 'expression', 'action')


def agreed(values: set[str]) -> str | None:
    """The single value that declared facts agree on, or None when they conflict or are empty."""
    specific = values - {'lying'}
    if 'lying' in values and len(specific) == 1 and specific <= set(LYING_POSTURES):
        values = specific
    return next(iter(values)) if len(values) == 1 else None
