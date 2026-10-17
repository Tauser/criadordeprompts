"""Closed vocabularies shared by the request, the catalog and the compiler."""
from typing import Literal

Category = Literal['subject', 'face', 'body', 'skin', 'hair', 'wardrobe', 'environment', 'pose',
                   'expression', 'action', 'lighting', 'style', 'camera', 'framing']
CATEGORIES: tuple[str, ...] = ('subject', 'face', 'body', 'skin', 'hair', 'wardrobe', 'environment', 'pose',
                               'expression', 'action', 'lighting', 'style', 'camera', 'framing')
Intent = Literal['keep', 'set', 'transfer', 'free']
Posture = Literal['standing', 'seated', 'kneeling', 'lying', 'walking', 'running', 'any']
Gaze = Literal['camera', 'away', 'down', 'up', 'back', 'closed', 'any']
Support = Literal['floor', 'seat', 'bed', 'wall', 'table']
Framing = Literal['portrait', 'half', 'full', 'wide']
FRAMING_ORDER = {'portrait': 0, 'half': 1, 'full': 2, 'wide': 3}
Confirmation = Literal['adults_only', 'consent_or_fictional']

# Categories whose kept/transferred value belongs to a person (identity group).
PERSON_ASPECTS = ('subject', 'face', 'body', 'skin', 'hair', 'wardrobe', 'pose', 'expression', 'action')
