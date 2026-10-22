"""Pedidos salvos: a request's choices kept as a reusable template, without the photos they point to."""
from __future__ import annotations

from ..domain.request import Request


def strip_for_preset(data: dict) -> dict:
    """Remove what belongs to a photo or to one run, and keep the choices of the scene.

    Removed: the target photo and its mask, reference photos, characters (each needs a reference photo), the seed,
    the number of people already in the photo, the supports and framing of the photo, and the adult-content
    confirmations (they attest to the people in the photos, so they are given again each time).
    """
    stripped = dict(data)
    stripped['target_id'] = None
    stripped['mask'] = False
    stripped['references'] = []
    stripped['characters'] = []
    stripped['confirmations'] = []
    stripped['output'] = {**(data.get('output') or {}), 'seed': None}
    stripped['participants'] = {**(data.get('participants') or {}), 'existing': None}
    stripped['context'] = {**(data.get('context') or {}), 'supports': None, 'original_framing': None}
    attributes = {}
    for category, attribute in (data.get('attributes') or {}).items():
        if attribute.get('intent') == 'transfer':
            # "transfer" copies from a reference photo. "keep" is only valid in edit mode (it keeps the target);
            # in generate mode nothing is kept, so the attribute is dropped and falls back to free.
            if data.get('mode') == 'edit':
                attributes[category] = {'intent': 'keep'}
            continue
        attributes[category] = attribute
    stripped['attributes'] = attributes
    return stripped


def preset_request(data: dict) -> dict:
    """The template as stored: stripped, validated against the Request contract, and JSON-ready."""
    return Request.model_validate(strip_for_preset(data)).model_dump(mode='json')
