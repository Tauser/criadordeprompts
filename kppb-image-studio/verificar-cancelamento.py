"""Cancellation contracts; no model execution or existing-job interruption."""
import copy
import io
import json
import unittest
import urllib.error
from unittest.mock import patch
import server


class Cancellation(unittest.TestCase):
    def setUp(self):
        self.jobs = {
            'refiner': {'kind': 'refine', 'intent': 'generate', 'seed': 1, 'child': 'image'},
            'image': {'kind': 'image', 'seed': 1, 'parent': 'refiner'},
            'other': {'kind': 'image', 'seed': 2},
        }

    def test_cancel_from_either_stage_targets_only_its_own_chain(self):
        for pid in ['refiner', 'image']:
            with self.subTest(pid=pid), patch.object(server, 'JOBS', copy.deepcopy(self.jobs)), \
                 patch.object(server, 'save_jobs'), patch.object(server, 'comfy') as api:
                result = server.cancel_generation(pid)
                self.assertEqual(result['status'], 'cancelled')
                self.assertEqual(api.call_args_list[0].args, ('/queue', {'delete': ['refiner', 'image']}))
                self.assertEqual([c.args for c in api.call_args_list[1:]], [
                    ('/interrupt', {'prompt_id': 'refiner'}), ('/interrupt', {'prompt_id': 'image'})])
                self.assertNotIn('cancel_requested', server.JOBS['other'])
                self.assertEqual(server.generation_status('refiner')['status'], 'cancelled')
                self.assertEqual(server.generation_status('image')['status'], 'cancelled')

    def test_standalone_queued_job_is_removed_without_global_queue_clear(self):
        with patch.object(server, 'JOBS', self.jobs), patch.object(server, 'save_jobs'), \
             patch.object(server, 'comfy') as api:
            server.cancel_generation('other')
            self.assertEqual(api.call_args_list[0].args, ('/queue', {'delete': ['other']}))
            self.assertEqual(api.call_args_list[1].args, ('/interrupt', {'prompt_id': 'other'}))

    def test_unknown_job_never_reaches_comfy(self):
        with patch.object(server, 'JOBS', self.jobs), patch.object(server, 'comfy') as api:
            with self.assertRaises(ValueError): server.cancel_generation('external-job')
            api.assert_not_called()

    def test_connection_failure_blocks_continuation_and_allows_retry(self):
        with patch.object(server, 'JOBS', self.jobs), patch.object(server, 'save_jobs'), \
             patch.object(server, 'comfy', side_effect=urllib.error.URLError('offline')):
            with self.assertRaises(urllib.error.URLError): server.cancel_generation('refiner')
            self.assertEqual(server.generation_status('refiner')['status'], 'cancelling')
            with self.assertRaises(ValueError): server.continue_generation('refiner')
        with patch.object(server, 'JOBS', self.jobs), patch.object(server, 'save_jobs'), \
             patch.object(server, 'comfy'):
            server.cancel_generation('refiner')
            self.assertEqual(server.generation_status('refiner')['status'], 'cancelled')

    def test_cancel_winning_race_after_refiner_completion_prevents_image_submission(self):
        def completed(_):
            self.jobs['refiner']['cancel_requested'] = True
            return {'status': 'completed', 'refined_prompt': 'Make the circle red.'}
        with patch.object(server, 'JOBS', self.jobs), \
             patch.object(server, 'generation_status', side_effect=completed), \
             patch.object(server, 'comfy') as api:
            with self.assertRaisesRegex(ValueError, 'cancelado'): server.continue_generation('refiner')
            api.assert_not_called()

    def test_empty_comfy_responses_and_json_responses_are_supported(self):
        for raw, expected in [(b'', {}), (b'  ', {}), (b'{"prompt_id":"test"}', {'prompt_id': 'test'})]:
            with self.subTest(raw=raw), patch.object(server.OPENER, 'open', return_value=io.BytesIO(raw)):
                self.assertEqual(server.comfy('/interrupt', {'prompt_id': 'test'}), expected)

    def test_cancel_route_uses_existing_origin_checks(self):
        handler = object.__new__(server.Handler)
        handler.path = '/api/cancel'
        handler.headers = {'Origin': 'https://external.invalid'}
        handler.server = type('LocalServer', (), {'server_port': 8770, 'allowed_hosts': {'localhost'}})()
        with patch.object(handler, 'client_allowed', return_value=True), \
             patch.object(handler, 'json_response') as reply, patch.object(server, 'cancel_generation') as cancel:
            handler.do_POST()
            self.assertEqual(reply.call_args.args[0], 403)
            cancel.assert_not_called()

    def test_cancel_route_passes_the_selected_job(self):
        handler = object.__new__(server.Handler)
        handler.path = '/api/cancel'
        raw = json.dumps({'prompt_id': 'image'}).encode()
        handler.headers = {'Content-Length': str(len(raw))}
        handler.rfile = io.BytesIO(raw)
        handler.server = type('LocalServer', (), {'server_port': 8770, 'allowed_hosts': {'localhost'}})()
        with patch.object(handler, 'client_allowed', return_value=True), \
             patch.object(handler, 'json_response') as reply, \
             patch.object(server, 'cancel_generation', return_value={'status': 'cancelled'}) as cancel:
            handler.do_POST()
            cancel.assert_called_once_with('image')
            self.assertEqual(reply.call_args.args[0], 200)


if __name__ == '__main__':
    unittest.main()
