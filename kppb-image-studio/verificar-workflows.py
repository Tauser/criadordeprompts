"""Behavioral checks for profile mapping and two-stage refinement; no real submissions."""
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
import copy
import unittest
import server
import workflow_adapter as workflows


class WorkflowTests(unittest.TestCase):
    def request(self, **changes):
        return {'mode': 'edit', 'profile': 'qwen21', 'prompt': 'Change the blue circle to red.',
                'resolution': 0, 'seed': 12345, 'images': [{'name': 'circle.png', 'role': 'target'}], **changes}

    def test_native_full_profile_matches_source_parameters(self):
        graph, seed = server.build_workflow(self.request(), ['target.png'])
        self.assertEqual(graph['2']['inputs']['unet_name'], workflows.PROFILES['qwen21']['model'])
        self.assertEqual(graph['9']['inputs']['steps'], 40)
        self.assertEqual(graph['9']['inputs']['seed'], seed)
        self.assertEqual(graph['9']['inputs']['latent_image'], ['5', 2])
        self.assertEqual(graph['5']['inputs']['resolution'], 0)
        self.assertEqual(graph['6']['inputs']['dtype'], 'default')
        self.assertEqual(graph['10']['class_type'], 'VAEDecode')
        self.assertEqual(graph['11']['inputs']['format.bit_depth'], '16-bit')
        self.assertNotIn('12', graph)

    def test_custom_size_is_applied_to_sampler_and_report(self):
        data = self.request(settings={'custom_size': True, 'width': 768, 'height': 1024})
        graph, seed = server.build_workflow(data, ['target.png'])
        self.assertEqual(graph['9']['inputs']['latent_image'], ['12', 0])
        report = server.request_summary(data, graph, seed)
        self.assertEqual((report['width'], report['height']), (768, 1024))
        self.assertEqual(report['aspect'], 'personalizado')

    def test_turbo_cannot_accidentally_use_full_scheduler(self):
        data = self.request(profile='turbo', resolution=1024, settings={'steps': 40})
        with self.assertRaises(ValueError): server.build_workflow(data, ['target.png'])
        data['settings'] = {'scheduler': 'simple'}
        with self.assertRaises(ValueError): server.build_workflow(data, ['target.png'])

    def test_invalid_settings_are_rejected_before_submission(self):
        for changes in [{'width': 513, 'custom_size': True}, {'cfg': float('nan')}, {'refine_prompt': 'false'},
                        {'steps': 0}, {'sampler': 'unknown'}, {'decode': 'unknown'}]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                server.build_workflow(self.request(settings=changes), ['target.png'])
        with self.assertRaises(ValueError):
            server.build_workflow(self.request(mode='generate'), [])

    def test_reference_order_and_negative_activation_are_reported(self):
        data = self.request(settings={'cfg': 2, 'negative_prompt': 'blurry'},
                            images=[{'name': 'target.png'}, {'name': 'scene.png'}])
        graph, seed = server.build_workflow(data, ['uploaded_target.png', 'uploaded_scene.png'])
        report = server.request_summary(data, graph, seed)
        self.assertEqual(graph['5']['inputs']['images.image_2'], ['102', 0])
        self.assertEqual(report['references'][1]['name'], 'scene.png')
        self.assertTrue(report['negative_active'])
        self.assertEqual(report['negative_prompt'], 'blurry')

    def test_refiner_off_has_no_language_model_or_prompt_rewrite(self):
        data = self.request()
        graph, _ = server.build_workflow(data, ['target.png'])
        self.assertEqual(graph['5']['inputs']['prompt'], data['prompt'])
        self.assertNotIn('TextGenerate', [n['class_type'] for n in graph.values()])

    def test_refiner_receives_images_and_independent_text_parameters(self):
        data = self.request(settings={'thinking': True, 'max_length': 512, 'temperature': .7})
        graph, seed = workflows.build_refiner(data, ['target.png', 'scene.png'])
        self.assertEqual(graph['32']['inputs']['images.image1'], ['102', 0])
        self.assertEqual(graph['33']['inputs']['sampling_mode.seed'], seed)
        self.assertEqual(graph['33']['inputs']['max_length'], 512)
        self.assertTrue(graph['33']['inputs']['thinking'])
        self.assertEqual(graph['34']['inputs']['source'], ['33', 0])

    def test_fixed_character_is_sent_to_both_stages_in_the_same_slot(self):
        data = self.request(images=[{'name': 'current.png', 'role': 'target'},
                                    {'name': 'character-original.png', 'role': 'character'},
                                    {'name': 'participant.png', 'role': 'second_participant'}])
        images = ['uploaded-current.png', 'uploaded-character.png', 'uploaded-participant.png']
        image_graph, seed = workflows.build(data, images)
        text_graph, _ = workflows.build_refiner(data, images)
        self.assertEqual(image_graph['5']['inputs']['images.image_2'], ['102', 0])
        self.assertEqual(text_graph['32']['inputs']['images.image1'], ['102', 0])
        self.assertEqual(image_graph['102']['inputs']['image'], images[1])
        self.assertEqual(text_graph['102']['inputs']['image'], images[1])
        report = workflows.summary(data, image_graph, seed)
        self.assertEqual(report['references'][1]['slot'], 'image_2')
        self.assertEqual(report['references'][1]['role'], 'character')
        self.assertEqual(image_graph['5']['inputs']['images.image_3'], ['103', 0])
        self.assertEqual(image_graph['103']['inputs']['image'], images[2])
        self.assertEqual(text_graph['103']['inputs']['image'], images[2])
        self.assertEqual(text_graph['32']['inputs']['images.image2'], ['103', 0])
        self.assertEqual(report['references'][2]['slot'], 'image_3')
        self.assertEqual(report['references'][2]['role'], 'second_participant')

    def test_refinement_continues_only_once_and_uses_exact_effective_prompt(self):
        data = self.request(settings={'refine_prompt': True}, request_id='12345678-1234-1234-1234-123456789abc')
        received = []
        def mock_comfy(endpoint, payload=None, **kwargs):
            if endpoint == '/prompt':
                received.append(copy.deepcopy(payload['prompt']))
                return {'prompt_id': 'parent' if len(received) == 1 else 'child'}
            if endpoint == '/history/parent':
                return {'parent': {'outputs': {'34': {'text': ['Internal reasoning.</think>Make the circle red. Preserve the white background.']}},
                                   'status': {'status_str': 'success'}}}
            raise AssertionError(endpoint)
        with TemporaryDirectory(dir=Path(__file__).resolve().parent) as temp, patch.object(server, 'JOBS', {}), patch.object(server, 'JOBS_PATH', Path(temp)/'jobs.json'), \
             patch.object(server, 'upload_image', return_value='uploaded.png') as upload, patch.object(server, 'comfy', side_effect=mock_comfy):
            parent = server.submit_generation(data)
            self.assertEqual(parent['kind'], 'refine')
            self.assertNotIn('KSampler', [n['class_type'] for n in received[0].values()])
            first = server.continue_generation('parent')
            again = server.continue_generation('parent')
            self.assertEqual(first['prompt_id'], again['prompt_id'])
            self.assertEqual(len(received), 2)
            upload.assert_called_once()
            self.assertEqual(received[1]['5']['inputs']['prompt'], first['request']['effective_prompt'])
            self.assertEqual(first['request']['original_prompt'], data['prompt'])
            self.assertEqual(received[1]['9']['inputs']['seed'], 12345)

    def test_empty_refinement_never_submits_an_image(self):
        with patch.object(server, 'JOBS', {'parent': {'kind': 'refine', 'intent': 'generate', 'seed': 1, 'request': {}}}), \
             patch.object(server, 'comfy', return_value={'parent': {'outputs': {'34': {'text': ['']}}, 'status': {'status_str': 'success'}}}) as call:
            with self.assertRaises(ValueError): server.continue_generation('parent')
            self.assertEqual(call.call_count, 1)

    def test_one_word_reply_to_detailed_request_is_not_used_for_generation(self):
        with patch.object(server, 'JOBS', {'parent': {'kind': 'refine', 'intent': 'generate', 'seed': 1,
                                                     'request': {'prompt': 'Change the blue circle to red and preserve the white background.'}}}), \
             patch.object(server, 'comfy', return_value={'parent': {'outputs': {'34': {'text': ['Change']}}, 'status': {'status_str': 'success'}}}) as call:
            with self.assertRaises(ValueError): server.continue_generation('parent')
            self.assertEqual(call.call_count, 1)


if __name__ == '__main__':
    unittest.main()
