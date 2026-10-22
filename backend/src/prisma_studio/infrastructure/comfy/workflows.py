"""API graphs built from code. Node ids, classes and model files live only here."""
from __future__ import annotations

import json
import math
from dataclasses import dataclass, field

UNET = {'qwen21': 'qwen_image_2.1_int8_convrot.safetensors', 'turbo': 'qwen_image_2.1_turbo_int8_convrot.safetensors'}
TEXT_ENCODER = 'qwen3vl_8b_int8_convrot.safetensors'
VAE = 'qwen_image_2.1_vae_bf16.safetensors'
PE_MODEL = 'qwen3.5_9b_qwen_image_2.1_pe_i2i.int8_convrot.safetensors'
FACE_MODEL = 'mediapipe_face_fp32.safetensors'   # ComfyUI models/detection: judge close-ups and face detail
PEOPLE_MODEL = 'rt_detr_v4-x-hgnet_fp16.safetensors'   # ComfyUI models/diffusion_models: people counted by body
SAM_MODEL = 'sam3.1_multiplex_fp16.safetensors'        # the checkpoint of SAM 3: masks what a text describes
TEXT_MASK_CHARS = 120              # SAM 3's text encoder reads at most 32 tokens; a longer text is refused
PERSON_SCORE = 0.75             # measured: whole people scored 0.79+, false and half-hidden hits 0.51-0.61
TURBO_SIGMAS = '1.0, 0.978453, 0.95418, 0.926626, 0.89508, 0.845148, 0.704534, 0.414568, 0.0'
PROFILES = {
    'qwen21': {'label': 'Qwen Image 2.1 completo', 'steps': 40, 'cfg': 1.0, 'sampler': 'euler', 'scheduler': 'simple',
               'denoise': 1.0, 'cache_dtype': 'default'},
    'turbo': {'label': 'Qwen Image 2.1 Turbo', 'steps': 8, 'cfg': 1.0, 'sampler': 'euler', 'scheduler': 'turbo',
              'denoise': 1.0, 'cache_dtype': 'int8'},
}
MAX_EDIT_PIXELS = 2048 * 2048
IMAGE_OUTPUT_NODE = '60'
TEXT_OUTPUT_NODE = '92'
PEOPLE_OUTPUT_NODE = '93'
LORA_NODES = 30                    # LoraLoaderModelOnly nodes of image graphs: 30, 31, 32
IMAGE_INPUT_NODES = 200            # LoadImage nodes of image graphs: 201, 202...
TEXT_IMAGE_NODES = 300             # LoadImage nodes of text graphs: 300, 301...
FACE_SIZE = 1024                   # side of the square face crop sent back to the image model
UPSCALE_MODEL = 'seedvr2_3b_int8_convrot.safetensors'   # ComfyUI models/diffusion_models: Ampliar no fim
UPSCALE_VAE = 'seedvr2_ema_vae_fp16.safetensors'         # ComfyUI models/vae


@dataclass(frozen=True)
class ImageJob:
    mode: str                         # generate | edit
    prompt: str
    profile: str = 'qwen21'
    seed: int = 0
    resolution: int = 1024            # 0 keeps the target size (edit only)
    width: int | None = None
    height: int | None = None
    images: tuple[str, ...] = ()      # uploaded names; images[0] is the edit target
    mask: str | None = None           # uploaded mask (white = editable area)
    negative_prompt: str = ''
    steps: int | None = None
    cfg: float | None = None
    sampler: str | None = None
    scheduler: str | None = None
    denoise: float | None = None
    mask_grow: int = 16
    mask_feather: int = 24
    prefix: str = 'prisma/studio'
    loras: tuple[tuple[str, float], ...] = ()   # (file name, strength), applied in order
    init_image: str | None = None     # uploaded picture to start from (img2img at `denoise`), not a reference


@dataclass(frozen=True)
class TextJob:
    prompt: str
    system_prompt: str
    images: tuple[str, ...] = ()
    max_length: int = 2048
    thinking: bool = False
    sampling: dict | None = None      # None = greedy (deterministic)
    seed: int = 0
    extra: dict = field(default_factory=dict)
    face_crops: int = 0               # faces to find in the first image and append as one enlarged close-up


ASPECTS = {'3:4': (3, 4), '2:3': (2, 3), '1:1': (1, 1), '16:9': (16, 9), '9:16': (9, 16), '4:3': (4, 3), '3:2': (3, 2)}


def generation_size(resolution: int, aspect: str) -> tuple[int, int]:
    a, b = ASPECTS[aspect]
    width = max(256, round(math.sqrt(resolution * resolution * a / b) / 32) * 32)
    height = max(256, round(math.sqrt(resolution * resolution * b / a) / 32) * 32)
    return width, height


def settings(job: ImageJob) -> dict:
    base = dict(PROFILES[job.profile])
    for key in ('steps', 'cfg', 'sampler', 'scheduler', 'denoise'):
        value = getattr(job, key)
        if value is not None:
            base[key] = value
    if job.profile == 'turbo':
        base.update(steps=8, cfg=1.0, sampler='euler', scheduler='turbo',
                    denoise=job.denoise if job.init_image and job.denoise is not None else 1.0)
    return base


def turbo_tail(denoise: float) -> str:
    """The turbo schedule from the first sigma at or below `denoise`: the distilled model only knows its own steps."""
    values = [float(v) for v in TURBO_SIGMAS.split(',')]
    start = next(i for i, v in enumerate(values) if v <= denoise + 1e-6)
    tail = values[min(start, len(values) - 2):]
    return ', '.join(f'{v:g}' for v in tail)


def image_graph(job: ImageJob) -> dict:
    if job.mode == 'edit' and not job.images:
        raise ValueError('A edição exige a foto alvo.')
    if job.mode == 'generate' and job.mask:
        raise ValueError('A geração não usa máscara.')
    s = settings(job)
    g: dict = {
        '1': {'class_type': 'UNETLoader', 'inputs': {'unet_name': UNET[job.profile], 'weight_dtype': 'default'}},
        '2': {'class_type': 'CLIPLoader', 'inputs': {'clip_name': TEXT_ENCODER, 'type': 'qwen_image', 'device': 'default'}},
        '3': {'class_type': 'VAELoader', 'inputs': {'vae_name': VAE}},
        '4': {'class_type': 'QwenImage21Cache', 'inputs': {'model': ['1', 0], 'device': 'cpu', 'dtype': s['cache_dtype']}},
        '10': {'class_type': 'TextEncodeQwenImage21', 'inputs': {
            'clip': ['2', 0], 'vae': ['3', 0], 'prompt': job.prompt, 'negative_prompt': job.negative_prompt,
            'resolution': job.resolution}},
    }
    model = ['1', 0]
    for index, (name, strength) in enumerate(job.loras):
        node = str(LORA_NODES + index)
        g[node] = {'class_type': 'LoraLoaderModelOnly', 'inputs': {'model': model, 'lora_name': name,
                                                                    'strength_model': strength}}
        model = [node, 0]
    g['4']['inputs']['model'] = model
    for index, name in enumerate(job.images, 1):
        g[str(IMAGE_INPUT_NODES + index)] = {'class_type': 'LoadImage', 'inputs': {'image': name}}
        g['10']['inputs'][f'images.image_{index}'] = [str(IMAGE_INPUT_NODES + index), 0]
    if job.init_image and (job.mode != 'generate' or job.width):
        raise ValueError('Partir de uma imagem é uma geração sem tamanho próprio: o tamanho é o da imagem.')
    if job.mode == 'generate' and not job.width and not job.init_image:
        raise ValueError('A geração exige largura e altura calculadas.')
    if job.width:
        width, height = job.width, job.height
        g['11'] = {'class_type': 'EmptySD3LatentImage', 'inputs': {'width': width, 'height': height, 'batch_size': 1}}
        latent = ['11', 0]
    elif job.init_image:
        g['12'] = {'class_type': 'LoadImage', 'inputs': {'image': job.init_image}}
        g['13'] = {'class_type': 'VAEEncode', 'inputs': {'pixels': ['12', 0], 'vae': ['3', 0]}}
        latent = ['13', 0]
    else:
        latent = ['10', 2]
    if job.profile == 'turbo':
        sigmas = turbo_tail(s['denoise']) if job.init_image else TURBO_SIGMAS
        g['40'] = {'class_type': 'ManualSigmas', 'inputs': {'sigmas': sigmas}}
        g['41'] = {'class_type': 'KSamplerSelect', 'inputs': {'sampler_name': 'euler'}}
        g['42'] = {'class_type': 'SamplerCustom', 'inputs': {
            'model': ['4', 0], 'add_noise': True, 'noise_seed': job.seed, 'cfg': 1.0, 'positive': ['10', 0],
            'negative': ['10', 1], 'sampler': ['41', 0], 'sigmas': ['40', 0], 'latent_image': latent}}
        sampled = ['42', 0]
    else:
        g['42'] = {'class_type': 'KSampler', 'inputs': {
            'model': ['4', 0], 'seed': job.seed, 'steps': s['steps'], 'cfg': s['cfg'], 'sampler_name': s['sampler'],
            'scheduler': s['scheduler'], 'denoise': s['denoise'], 'positive': ['10', 0], 'negative': ['10', 1],
            'latent_image': latent}}
        sampled = ['42', 0]
    g['50'] = {'class_type': 'VAEDecode', 'inputs': {'samples': sampled, 'vae': ['3', 0]}}
    final = ['50', 0]
    if job.mask:
        # The target and the mask were normalized to the same multiple-of-32 size before upload,
        # so the decoded image, the target and the mask align pixel for pixel.
        g['51'] = {'class_type': 'LoadImageMask', 'inputs': {'image': job.mask, 'channel': 'red'}}
        g['52'] = {'class_type': 'GrowMask', 'inputs': {'mask': ['51', 0], 'expand': job.mask_grow,
                                                         'tapered_corners': True}}
        g['53'] = {'class_type': 'FeatherMask', 'inputs': {'mask': ['52', 0], 'left': job.mask_feather,
                                                            'top': job.mask_feather, 'right': job.mask_feather,
                                                            'bottom': job.mask_feather}}
        g['54'] = {'class_type': 'ImageCompositeMasked', 'inputs': {
            'destination': [str(IMAGE_INPUT_NODES + 1), 0], 'source': final, 'x': 0, 'y': 0, 'resize_source': False, 'mask': ['53', 0]}}
        final = ['54', 0]
    g[IMAGE_OUTPUT_NODE] = {'class_type': 'SaveImage', 'inputs': {'images': final, 'filename_prefix': job.prefix}}
    return g


def face_detect_graph(image: str, faces: int, min_confidence: float = 0.5, people: bool = False) -> dict:
    """Find up to `faces` faces with ComfyUI's MediaPipe detector; the boxes come back as text. With `people`, RT-DETR
    also finds whole bodies, so a person turned away or with a hidden face is counted too."""
    graph = {
        '70': {'class_type': 'LoadImage', 'inputs': {'image': image}},
        '71': {'class_type': 'LoadMediaPipeFaceLandmarker', 'inputs': {'model_name': FACE_MODEL}},
        '72': {'class_type': 'MediaPipeFaceLandmarker', 'inputs': {
            'face_detection_model': ['71', 0], 'image': ['70', 0], 'detector_variant': 'full', 'num_faces': faces,
            'min_confidence': min_confidence, 'missing_frame_fallback': 'empty'}},
        TEXT_OUTPUT_NODE: {'class_type': 'PreviewAny', 'inputs': {'source': ['72', 1]}},
    }
    if people:
        graph.update({
            '73': {'class_type': 'UNETLoader', 'inputs': {'unet_name': PEOPLE_MODEL, 'weight_dtype': 'default'}},
            '74': {'class_type': 'RTDETR_detect', 'inputs': {'model': ['73', 0], 'image': ['70', 0], 'threshold': 0.5,
                                                             'class_name': 'person', 'max_detections': 10}},
            PEOPLE_OUTPUT_NODE: {'class_type': 'PreviewAny', 'inputs': {'source': ['74', 0]}},
        })
    return graph


def text_mask_graph(image: str, text: str) -> dict:
    """SAM 3 finds what `text` describes in the image. The mask comes back as a picture through the image output:
    white where the object is, black elsewhere, at the picture's size."""
    return {
        'A': {'class_type': 'CheckpointLoaderSimple', 'inputs': {'ckpt_name': SAM_MODEL}},
        'B': {'class_type': 'CLIPTextEncode', 'inputs': {'clip': ['A', 1], 'text': text}},
        'C': {'class_type': 'LoadImage', 'inputs': {'image': image}},
        'D': {'class_type': 'SAM3_Detect', 'inputs': {
            'model': ['A', 0], 'image': ['C', 0], 'conditioning': ['B', 0], 'threshold': 0.5,
            'refine_iterations': 2, 'individual_masks': False}},
        'E': {'class_type': 'MaskToImage', 'inputs': {'mask': ['D', 0]}},
        IMAGE_OUTPUT_NODE: {'class_type': 'SaveImage', 'inputs': {'images': ['E', 0], 'filename_prefix': 'prisma/textmask'}},
    }


def people_count(text: str | None) -> int | None:
    """Whole people RT-DETR is sure of; None when the detector did not run or its answer is unreadable."""
    try:
        found = json.loads(text) if text else None
    except ValueError:
        return None
    if not isinstance(found, list):
        return None
    boxes = found[0] if found and isinstance(found[0], list) else found
    return sum(1 for b in boxes if isinstance(b, dict) and float(b.get('score') or 0) >= PERSON_SCORE)


def face_boxes(text: str | None) -> list[dict]:
    """Boxes of the first (only) frame as {x, y, width, height, score}; malformed entries are dropped."""
    try:
        frames = json.loads(text or '[]')
    except ValueError:
        return []
    frame = frames[0] if isinstance(frames, list) and frames and isinstance(frames[0], list) else []
    boxes = []
    for box in frame:
        try:
            values = {k: float(box[k]) for k in ('x', 'y', 'width', 'height')}
        except (KeyError, TypeError, ValueError):
            continue
        if values['width'] > 0 and values['height'] > 0:
            boxes.append({**values, 'score': float(box.get('score') or 0)})
    # Measured: the detector sometimes reports one face twice, nearly on top of itself; the weaker copy goes.
    return [b for i, b in enumerate(boxes)
            if not any(_overlap(b, o) > 0.5 and (o['score'], -j) > (b['score'], -i) for j, o in enumerate(boxes))]


def _overlap(a: dict, b: dict) -> float:
    """Intersection over union of two boxes."""
    width = min(a['x'] + a['width'], b['x'] + b['width']) - max(a['x'], b['x'])
    height = min(a['y'] + a['height'], b['y'] + b['height']) - max(a['y'], b['y'])
    if width <= 0 or height <= 0:
        return 0.0
    shared = width * height
    return shared / (a['width'] * a['height'] + b['width'] * b['height'] - shared)


def upscale_graph(image_name: str, factor: float, seed: int, prefix: str = 'prisma/studio_up') -> dict:
    """SeedVR2 redraws the picture `factor` times larger in one step; the output is saved under IMAGE_OUTPUT_NODE."""
    tiles = {'tile_size': 512, 'overlap': 128, 'temporal_size': 4096, 'temporal_overlap': 8}
    return {
        '1': {'class_type': 'LoadImage', 'inputs': {'image': image_name}},
        '57': {'class_type': 'ResizeImageMaskNode', 'inputs': {
            'input': ['1', 0], 'resize_type': 'scale by multiplier', 'resize_type.multiplier': factor,
            'scale_method': 'lanczos'}},
        '58': {'class_type': 'SeedVR2Preprocess', 'inputs': {'resized_images': ['57', 0]}},
        '51': {'class_type': 'VAELoader', 'inputs': {'vae_name': UPSCALE_VAE}},
        '52': {'class_type': 'UNETLoader', 'inputs': {'unet_name': UPSCALE_MODEL, 'weight_dtype': 'default'}},
        '48': {'class_type': 'VAEEncodeTiled', 'inputs': {'pixels': ['58', 0], 'vae': ['51', 0], **tiles}},
        '61': {'class_type': 'SeedVR2Conditioning', 'inputs': {'model': ['52', 0], 'vae_conditioning': ['48', 0]}},
        '54': {'class_type': 'KSampler', 'inputs': {
            'model': ['52', 0], 'positive': ['61', 0], 'negative': ['61', 1], 'latent_image': ['48', 0], 'seed': seed,
            'steps': 1, 'cfg': 1.0, 'sampler_name': 'euler', 'scheduler': 'simple', 'denoise': 1.0}},
        '55': {'class_type': 'VAEDecodeTiled', 'inputs': {'samples': ['54', 0], 'vae': ['51', 0], **tiles}},
        '59': {'class_type': 'SeedVR2PostProcessing', 'inputs': {
            'images': ['55', 0], 'original_resized_images': ['57', 0], 'color_correction_method': 'lab'}},
        IMAGE_OUTPUT_NODE: {'class_type': 'SaveImage', 'inputs': {'images': ['59', 0], 'filename_prefix': prefix}},
    }


def text_graph(job: TextJob) -> dict:
    inputs = {'clip': ['80', 0], 'system_prompt': ['81', 0], 'prompt': job.prompt, 'max_length': job.max_length,
              'thinking': job.thinking, 'use_default_template': True, 'mtp': 'auto'}
    if job.sampling is None:
        inputs['sampling_mode'] = 'off'
    else:
        inputs['sampling_mode'] = 'on'
        for key, value in job.sampling.items():
            inputs['sampling_mode.' + key] = value
        inputs['sampling_mode.seed'] = job.seed
    g: dict = {
        '80': {'class_type': 'CLIPLoader', 'inputs': {'clip_name': PE_MODEL, 'type': 'qwen_image', 'device': 'default'}},
        '81': {'class_type': 'PrimitiveStringMultiline', 'inputs': {'value': job.system_prompt}},
    }
    if job.images:
        g['85'] = {'class_type': 'BatchImagesNode', 'inputs': {}}
        for index, name in enumerate(job.images):
            node = str(TEXT_IMAGE_NODES + index)   # own range: never collides with the fixed nodes below 100
            g[node] = {'class_type': 'LoadImage', 'inputs': {'image': name}}
            g['85']['inputs'][f'images.image{index}'] = [node, 0]
        if job.face_crops:
            # The 'full' detector finds the small faces of full-body shots; keeping only the expected number of
            # faces (highest scores first) drops the false hits on hands and chests. No face: the whole image.
            first = [str(TEXT_IMAGE_NODES), 0]
            g['86'] = {'class_type': 'LoadMediaPipeFaceLandmarker', 'inputs': {'model_name': FACE_MODEL}}
            g['87'] = {'class_type': 'MediaPipeFaceLandmarker', 'inputs': {
                'face_detection_model': ['86', 0], 'image': first, 'detector_variant': 'full',
                'num_faces': min(job.face_crops, 16), 'min_confidence': 0.5, 'missing_frame_fallback': 'empty'}}
            g['88'] = {'class_type': 'CropByBBoxes', 'inputs': {
                'image': first, 'bboxes': ['87', 1], 'output_width': 1024, 'output_height': 1024, 'padding': 32,
                'keep_aspect': 'pad'}}
            g['85']['inputs'][f'images.image{len(job.images)}'] = ['88', 0]
        inputs['image'] = ['85', 0]
    g['90'] = {'class_type': 'TextGenerate', 'inputs': inputs}
    g[TEXT_OUTPUT_NODE] = {'class_type': 'PreviewAny', 'inputs': {'source': ['90', 0]}}
    return g


def image_outputs(outputs: dict) -> list[dict]:
    node = outputs.get(IMAGE_OUTPUT_NODE, {})
    return [im for im in node.get('images', []) if im.get('type') == 'output']


def text_output(outputs: dict, node: str = TEXT_OUTPUT_NODE) -> str | None:
    value = outputs.get(node, {}).get('text')
    if isinstance(value, list):
        value = value[0] if value else None
    return value if isinstance(value, str) else None
