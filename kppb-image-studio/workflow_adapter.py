"""Local Qwen profiles. Catalog text is independent of these API graphs."""
from pathlib import Path
import copy
import json
import math
import secrets

ROOT = Path(__file__).resolve().parent
PRESETS = ROOT.parent / 'workflows' / 'presets-api'
SCHEMAS = json.loads((ROOT / 'schema-workflows.json').read_text(encoding='utf-8'))

PROFILES = {
    'turbo': {
        'label': 'Qwen Image 2.1 Turbo', 'model': 'qwen_image_2.1_turbo_int8_convrot.safetensors',
        'defaults': {'steps': 8, 'cfg': 1, 'sampler': 'euler', 'scheduler': 'turbo_sigmas',
                     'resolution': 1024, 'cache_device': 'cpu', 'cache_dtype': 'int8',
                     'decode': 'tiled', 'bit_depth': '8-bit', 'denoise': 1},
    },
    'qwen21': {
        'label': 'Qwen Image 2.1 completo', 'model': 'qwen_image_2.1_int8_convrot.safetensors',
        'defaults': {'steps': 40, 'cfg': 1, 'sampler': 'euler', 'scheduler': 'simple',
                     'resolution': 0, 'cache_device': 'cpu', 'cache_dtype': 'default',
                     'decode': 'normal', 'bit_depth': '16-bit', 'denoise': 1},
    },
}
PE_MODEL = 'qwen3.5_9b_qwen_image_2.1_pe_i2i.int8_convrot.safetensors'


def options():
    required = SCHEMAS['KSampler']['input']['required']
    return {'profiles': PROFILES, 'samplers': required['sampler_name'][0],
            'schedulers': required['scheduler'][0], 'refiner_model': PE_MODEL}


def number(value, name, low, high, integer=False):
    if isinstance(value, bool):
        raise ValueError(f'{name} inválido.')
    try:
        result = float(value)
    except (TypeError, ValueError):
        raise ValueError(f'{name} inválido.') from None
    if not math.isfinite(result) or result < low or result > high or (integer and not result.is_integer()):
        raise ValueError(f'{name} deve estar entre {low} e {high}.')
    return int(result) if integer else result


def flag(settings, key, default=False):
    value = settings.get(key, default)
    if not isinstance(value, bool):
        raise ValueError(f'{key} deve ser verdadeiro ou falso.')
    return value


def validate(data, image_names):
    prompt = data.get('prompt', '')
    if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 12000:
        raise ValueError('Informe um prompt com até 12.000 caracteres.')
    mode = data.get('mode')
    if mode not in ('edit', 'generate'):
        raise ValueError('Modo desconhecido.')
    if len(image_names) > 10 or (mode == 'edit' and not image_names):
        raise ValueError('Adicione uma foto alvo e use até dez referências.')
    profile = data.get('profile', 'turbo')
    if profile not in PROFILES:
        raise ValueError('Perfil de workflow desconhecido.')
    source = data.get('settings', {})
    if not isinstance(source, dict):
        raise ValueError('Configurações inválidas.')
    config = {**PROFILES[profile]['defaults'], **source}
    resolution = number(data.get('resolution', config['resolution']), 'Resolução', 0, 2048, True)
    if resolution not in (0, 1024, 1536, 2048) or (resolution == 0 and mode != 'edit'):
        raise ValueError('Use 1024, 1536 ou 2048; Original está disponível apenas em edição.')
    config['resolution'] = resolution
    config['steps'] = number(config['steps'], 'Passos', 1, 100, True)
    config['cfg'] = number(config['cfg'], 'CFG', 1, 20)
    config['denoise'] = number(config['denoise'], 'Denoise', 0.01, 1)
    schema = options()
    choices = {'cache_device': ['auto', 'cpu', 'gpu', 'off'],
               'cache_dtype': ['default', 'int8', 'int4'], 'decode': ['normal', 'tiled'],
               'bit_depth': ['8-bit', '16-bit'], 'sampler': schema['samplers'],
               'scheduler': schema['schedulers'] + ['turbo_sigmas']}
    for name, values in choices.items():
        if config[name] not in values:
            raise ValueError(f'{name} desconhecido.')
    if profile == 'turbo' and (config['steps'] != 8 or config['cfg'] != 1 or
                              config['sampler'] != 'euler' or config['scheduler'] != 'turbo_sigmas' or config['denoise'] != 1):
        raise ValueError('O Turbo usa oito passos, CFG 1, Euler e sua sequência própria de sigmas.')
    if profile == 'qwen21' and config['scheduler'] == 'turbo_sigmas':
        raise ValueError('A sequência Turbo não se aplica ao modelo completo.')
    config['custom_size'] = flag(source, 'custom_size')
    config['refine_prompt'] = flag(source, 'refine_prompt')
    if profile == 'turbo' and config['refine_prompt']:
        raise ValueError('O aprimorador está disponível no perfil Qwen 2.1 completo.')
    config['thinking'] = flag(source, 'thinking', True)
    config['negative_prompt'] = source.get('negative_prompt', '')
    if not isinstance(config['negative_prompt'], str) or len(config['negative_prompt']) > 12000:
        raise ValueError('Prompt negativo inválido ou muito longo.')
    aspect = data.get('aspect', '3:4')
    if aspect not in ('3:4', '2:3', '1:1', '16:9', '9:16'):
        raise ValueError('Formato inválido.')
    if config['custom_size']:
        for dimension in ['width', 'height']:
            config[dimension] = number(source.get(dimension, 1024), dimension, 256, 2048, True)
            if config[dimension] % 32:
                raise ValueError('Largura e altura devem ser múltiplos de 32.')
    elif mode == 'generate':
        a, b = map(int, aspect.split(':'))
        config['width'] = max(32, round(math.sqrt(resolution**2 * a / b) / 32) * 32)
        config['height'] = max(32, round(math.sqrt(resolution**2 * b / a) / 32) * 32)
    else:
        config['width'] = config['height'] = None
    config['max_length'] = number(source.get('max_length', 4132), 'Limite de tokens', 128, 24000, True)
    for name, default, low, high in [('temperature', 1, .01, 2), ('top_k', 20, 0, 1000),
                                     ('top_p', .95, 0, 1), ('min_p', 0, 0, 1),
                                     ('repetition_penalty', 1, .01, 5), ('presence_penalty', 0, 0, 5)]:
        config[name] = number(source.get(name, default), name, low, high, name == 'top_k')
    config['sampling_mode'] = source.get('sampling_mode', 'on')
    config['mtp'] = source.get('mtp', 'auto')
    if config['sampling_mode'] not in ['on', 'off'] or config['mtp'] not in ['auto', 'off', '2', '3', '4', '5']:
        raise ValueError('Configuração do aprimorador desconhecida.')
    raw_seed = data.get('seed')
    seed = secrets.randbelow(2**32) if raw_seed in (None, '') else number(raw_seed, 'Seed', 0, 2**53 - 1, True)
    return profile, config, seed


def image_nodes(graph, image_names, target):
    for index, name in enumerate(image_names, 1):
        node = str(100 + index)
        graph[node] = {'class_type': 'LoadImage', 'inputs': {'image': name}}
        graph[target]['inputs'][f'images.image_{index}'] = [node, 0]


def build(data, image_names):
    profile, config, seed = validate(data, image_names)
    if profile == 'turbo':
        graph = json.loads((PRESETS / 'editor-qwen21-turbo-oficial.json').read_text(encoding='utf-8-sig'))
        graph.pop('1')
        graph['5']['inputs'].pop('images.image_1', None)
        graph['9']['inputs']['noise_seed'] = seed
    else:
        original = json.loads((PRESETS / 'editor-qwen21-completo-studio.json').read_text(encoding='utf-8'))
        mapping = {'459:451': '2', '459:453': '3', '459:454': '4', '459:474': '5',
                   '459:469': '6', '459:458': '9', '459:457': '10', '461': '11'}
        def remap(value):
            if isinstance(value, list):
                return [mapping.get(value[0], value[0]), value[1]] if len(value) == 2 and isinstance(value[0], str) and isinstance(value[1], int) else [remap(x) for x in value]
            if isinstance(value, dict):
                return {k: remap(v) for k, v in value.items()}
            return value
        graph = {dest: remap(copy.deepcopy(original[src])) for src, dest in mapping.items()}
        graph['5']['inputs'] = {k: v for k, v in graph['5']['inputs'].items() if not k.startswith('images.')}
        graph['9']['inputs'].update(seed=seed, steps=config['steps'], cfg=config['cfg'],
                                   sampler_name=config['sampler'], scheduler=config['scheduler'],
                                   denoise=config['denoise'], latent_image=['5', 2])
    graph['5']['inputs'].update(prompt=data['prompt'].strip(), negative_prompt=config['negative_prompt'], resolution=config['resolution'])
    graph['6']['inputs'].update(device=config['cache_device'], dtype=config['cache_dtype'])
    if data['mode'] == 'edit':
        image_nodes(graph, image_names, '5')
    if data['mode'] == 'generate' or config['custom_size']:
        graph['12'] = {'class_type': 'EmptySD3LatentImage', 'inputs': {
            'width': config['width'], 'height': config['height'], 'batch_size': 1}}
        graph['9']['inputs']['latent_image'] = ['12', 0]
    if config['decode'] == 'normal':
        graph['10'] = {'class_type': 'VAEDecode', 'inputs': {'samples': ['9', 0], 'vae': ['4', 0]}}
    else:
        graph['10'] = {'class_type': 'VAEDecodeTiled', 'inputs': {'samples': ['9', 0], 'vae': ['4', 0],
            'tile_size': 512, 'overlap': 64, 'temporal_size': 64, 'temporal_overlap': 8}}
    prefix = 'imagens/KPPB_Qwen21_' + ('Turbo' if profile == 'turbo' else 'Completo')
    if config['bit_depth'] == '16-bit':
        graph['11'] = {'class_type': 'SaveImageAdvanced', 'inputs': {'images': ['10', 0], 'filename_prefix': prefix,
            'format': 'png', 'format.bit_depth': '16-bit', 'format.input_color_space': 'sRGB'}}
    else:
        graph['11'] = {'class_type': 'SaveImage', 'inputs': {'images': ['10', 0], 'filename_prefix': prefix}}
    return graph, seed


def build_refiner(data, image_names):
    profile, config, seed = validate(data, image_names)
    if profile != 'qwen21':
        raise ValueError('Selecione o Qwen 2.1 completo para aprimorar o prompt.')
    original = json.loads((PRESETS / 'editor-qwen21-completo-studio.json').read_text(encoding='utf-8'))
    graph = {'30': copy.deepcopy(original['459:477']), '31': copy.deepcopy(original['459:479'])}
    inputs = {'clip': ['30', 0], 'system_prompt': ['31', 0], 'prompt': data['prompt'].strip(),
              'max_length': config['max_length'], 'thinking': config['thinking'], 'use_default_template': True,
              'mtp': config['mtp'], 'sampling_mode': config['sampling_mode']}
    if config['sampling_mode'] == 'on':
        for field in ['temperature', 'top_k', 'top_p', 'min_p', 'repetition_penalty', 'presence_penalty']:
            inputs['sampling_mode.' + field] = config[field]
        inputs['sampling_mode.seed'] = seed
    if data['mode'] == 'edit':
        graph['32'] = {'class_type': 'BatchImagesNode', 'inputs': {}}
        for index, name in enumerate(image_names, 1):
            node = str(100 + index)
            graph[node] = {'class_type': 'LoadImage', 'inputs': {'image': name}}
            graph['32']['inputs'][f'images.image{index-1}'] = [node, 0]
        inputs['image'] = ['32', 0]
    graph['33'] = {'class_type': 'TextGenerate', 'inputs': inputs}
    graph['34'] = {'class_type': 'PreviewAny', 'inputs': {'source': ['33', 0]}}
    return graph, seed


def summary(data, graph, seed):
    profile, config, _ = validate({**data, 'seed': seed}, ['summary'] if data['mode'] == 'edit' else [])
    result = {'prompt': data['prompt'].strip(), 'profile': profile, 'workflow': PROFILES[profile]['label'],
              'model': PROFILES[profile]['model'], 'mode': data['mode'], 'resolution': config['resolution'],
              'aspect': 'personalizado' if config['custom_size'] else data.get('aspect', '3:4') if data['mode'] == 'generate' else 'proporção da foto alvo',
              'seed': seed, 'steps': config['steps'], 'cfg': config['cfg'], 'sampler': config['sampler'],
              'scheduler': config['scheduler'], 'denoise': config['denoise'], 'negative_prompt': config['negative_prompt'],
              'negative_active': config['cfg'] != 1, 'cache_device': config['cache_device'], 'cache_dtype': config['cache_dtype'],
              'decode': config['decode'], 'bit_depth': config['bit_depth'], 'refine_prompt': config['refine_prompt'],
              'references': [{'slot': f'image_{i}', 'name': image.get('name', f'referência {i}'), 'role': image.get('role', '')}
                             for i, image in enumerate(data.get('images', []), 1)] if data['mode'] == 'edit' else []}
    if data['mode'] == 'generate' or config['custom_size']:
        result.update(width=config['width'], height=config['height'])
    if config['refine_prompt']:
        result['refiner'] = {key: config[key] for key in ['thinking', 'max_length', 'sampling_mode', 'temperature', 'top_k', 'top_p', 'min_p', 'repetition_penalty', 'presence_penalty', 'mtp']}
        result['refiner'].update(model=PE_MODEL, seed=seed)
    return result
