import unittest
from unittest.mock import patch
from comfy_progress import ComfyProgress
import server


class ProgressTests(unittest.TestCase):
    def setUp(self):
        self.tracker = ComfyProgress('http://127.0.0.1:8188', 'test-client')
        self.tracker.connected.set()

    def event(self, kind, **data):
        self.tracker.handle({'type': kind, 'data': {'prompt_id': 'job-a', **data}})

    def test_sampler_percentage_and_step_counts(self):
        self.event('progress', node='9', value=18, max=40)
        self.assertEqual(self.tracker.snapshot('job-a'),
                         {'phase': 'sampling', 'value': 18, 'maximum': 40, 'percent': 45})

    def test_jobs_do_not_share_progress(self):
        self.event('progress', node='9', value=3, max=8)
        self.tracker.handle({'type': 'progress', 'data': {'prompt_id': 'job-b', 'node': '9', 'value': 1, 'max': 40}})
        self.assertEqual(self.tracker.snapshot('job-a')['percent'], 37.5)
        self.assertEqual(self.tracker.snapshot('job-b')['percent'], 2.5)

    def test_decoding_and_saving_keep_completed_sampler_percentage(self):
        self.event('progress', node='9', value=40, max=40)
        for node, phase in [('10', 'decoding'), ('11', 'saving')]:
            self.event('executing', node=node)
            self.event('progress', node=node, value=1, max=4)
            self.assertEqual(self.tracker.snapshot('job-a')['phase'], phase)
            self.assertEqual(self.tracker.snapshot('job-a')['percent'], 100)

    def test_new_progress_state_events(self):
        self.event('progress_state', nodes={'9': {'state': 'running', 'value': 4, 'max': 8}})
        self.assertEqual(self.tracker.snapshot('job-a')['percent'], 50)

    def test_finished_nodes_do_not_replace_current_phase(self):
        self.event('executing', node='10')
        self.event('progress_state', nodes={'9': {'state': 'finished', 'value': 8, 'max': 8},
                                            '10': {'state': 'running', 'value': 1, 'max': 4}})
        self.assertEqual(self.tracker.snapshot('job-a')['phase'], 'decoding')

    def test_refinement_has_no_fake_image_percentage(self):
        self.event('executing', node='33')
        self.event('progress', node='33', value=80, max=4000)
        self.assertEqual(self.tracker.snapshot('job-a'), {'phase': 'refining'})

    def test_invalid_counts_are_ignored_and_values_are_clamped(self):
        for value, maximum in [(1, 0), (float('nan'), 40), (2, float('inf')), ('3', 8)]:
            self.event('progress', node='9', value=value, max=maximum)
            self.assertNotIn('percent', self.tracker.snapshot('job-a'))
        self.event('progress', node='9', value=20, max=8)
        self.assertEqual(self.tracker.snapshot('job-a')['percent'], 100)

    def test_restart_clears_previous_steps(self):
        self.event('progress', node='9', value=4, max=8)
        self.event('execution_start')
        self.assertEqual(self.tracker.snapshot('job-a'), {'phase': 'preparing'})

    def test_disconnected_monitor_does_not_return_stale_progress(self):
        self.event('progress', node='9', value=4, max=8)
        self.tracker.connected.clear()
        self.assertIsNone(self.tracker.snapshot('job-a'))

    def test_unidentified_events_are_ignored(self):
        self.tracker.handle({'type': 'progress', 'data': {'value': 1, 'max': 8}})
        self.assertEqual(len(self.tracker.jobs), 0)

    def test_running_api_returns_only_requested_job_progress(self):
        self.event('progress', node='9', value=4, max=8)
        with patch.object(server, 'PROGRESS', self.tracker), \
             patch.object(server, 'JOBS', {'job-a': {'seed': 1, 'kind': 'image'}}), \
             patch.object(server, 'comfy', side_effect=[{}, {'queue_running': [[0, 'job-a']], 'queue_pending': []}]):
            status = server.generation_status('job-a')
        self.assertEqual(status['progress']['percent'], 50)
        self.assertEqual(status['status'], 'running')


if __name__ == '__main__':
    unittest.main()
