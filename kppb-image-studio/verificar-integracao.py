import ast
import json
from pathlib import Path
import unittest
from unittest.mock import patch
from email.message import Message
import server

ROOT = Path(__file__).resolve().parent

class Integration(unittest.TestCase):
    def test_editor_disables_browser_cache(self):
        handler = object.__new__(server.Handler)
        handler.path = '/KPPB_Image_Studio_v5_1.html'
        handler.headers = Message()
        handler.headers['If-Modified-Since'] = 'Tue, 13 Oct 2026 23:59:59 GMT'
        with patch.object(server.SimpleHTTPRequestHandler, 'send_head') as read_file:
            handler.send_head()
            read_file.assert_called_once()
            self.assertNotIn('If-Modified-Since', handler.headers)
        with patch.object(handler, 'send_header') as header, patch.object(server.SimpleHTTPRequestHandler, 'end_headers'):
            handler.end_headers()
            header.assert_called_once_with('Cache-Control', 'no-store')

    def test_text_catalog_is_served_without_cache(self):
        self.assertIn('/textos-prompts.js', server.PUBLIC_FILES)
        self.assertNotIn('/server.py', server.PUBLIC_FILES)
        self.assertNotIn('/jobs.json', server.PUBLIC_FILES)
        handler = object.__new__(server.Handler)
        handler.path = '/textos-prompts.js'
        handler.headers = Message()
        handler.headers['If-Modified-Since'] = 'Tue, 13 Oct 2026 23:59:59 GMT'
        with patch.object(server.SimpleHTTPRequestHandler, 'send_head'):
            handler.send_head()
            self.assertNotIn('If-Modified-Since', handler.headers)
        with patch.object(handler, 'send_header') as header, patch.object(server.SimpleHTTPRequestHandler, 'end_headers'):
            handler.end_headers()
            header.assert_called_once_with('Cache-Control', 'no-store')

    def test_submitted_request_matches_workflow(self):
        data = {'mode': 'generate', 'prompt': 'A blue mug on a wooden table.', 'resolution': 1536, 'aspect': '16:9', 'seed': 1234}
        graph, seed = server.build_workflow(data, [])
        summary = server.request_summary(data, graph, seed)
        self.assertEqual(summary['prompt'], data['prompt'])
        self.assertEqual(summary['resolution'], 1536)
        self.assertEqual(summary['seed'], 1234)
        self.assertEqual(summary['width'], graph['12']['inputs']['width'])
        self.assertEqual(summary['height'], graph['12']['inputs']['height'])

    def test_edit_request_reports_target_aspect_and_reference_order(self):
        data = {'mode': 'edit', 'prompt': 'Change the jacket color.', 'aspect': '16:9', 'images': [{'name':'target.png','role':'target'}, {'name':'pose.png','role':'pose'}]}
        graph, seed = server.build_workflow(data, ['uploaded_target.png', 'uploaded_pose.png'])
        summary = server.request_summary(data, graph, seed)
        self.assertEqual(summary['aspect'], 'proporção da foto alvo')
        self.assertEqual(summary['references'][0]['name'], 'target.png')
        self.assertEqual(summary['references'][1]['slot'], 'image_2')

    def test_lan_origin(self):
        hosts = {'127.0.0.1', 'localhost', '192.168.1.3'}
        self.assertTrue(server.allowed_origin('http://192.168.1.3:8770', 8770, hosts))
        self.assertTrue(server.allowed_origin('http://127.0.0.1:8770', 8770, hosts))
        self.assertFalse(server.allowed_origin('http://example.com:8770', 8770, hosts))
        self.assertFalse(server.allowed_origin('http://192.168.1.3:8188', 8770, hosts))
        self.assertFalse(server.allowed_origin('http://192.168.1.3:invalid', 8770, hosts))

    def test_generation(self):
        graph, seed = server.build_workflow({'mode': 'generate', 'prompt': 'Photorealistic blue ceramic coffee mug on a wooden table by a window, soft daylight, no people.', 'resolution': 1024, 'aspect': '1:1', 'seed': 20261013}, [])
        self.assertNotIn('images.image_1', graph['5']['inputs'])
        self.assertEqual(graph['12']['inputs']['width'], 1024)
        self.assertEqual(graph['12']['inputs']['height'], 1024)
        self.assertEqual(seed, 20261013)
        (ROOT / 'workflow-teste-geracao.json').write_text(json.dumps(graph, indent=2), encoding='utf-8')

    def test_reference_order(self):
        graph, _ = server.build_workflow({'mode':'edit','prompt':'Replace the jacket with a blue shirt.','resolution':1024}, ['target.png','pose.png','scene.png'])
        self.assertEqual(graph['101']['inputs']['image'], 'target.png')
        self.assertEqual(graph['102']['inputs']['image'], 'pose.png')
        self.assertEqual(graph['103']['inputs']['image'], 'scene.png')
        self.assertEqual(graph['5']['inputs']['images.image_3'], ['103',0])
        self.assertEqual(graph['9']['inputs']['latent_image'], ['5',2])

    def test_missing_target_rejected(self):
        with self.assertRaises(ValueError):
            server.build_workflow({'mode':'edit','prompt':'Change the jacket.'}, [])

    def test_invalid_resolution_rejected(self):
        with self.assertRaises(ValueError):
            server.build_workflow({'mode':'generate','prompt':'A coffee mug.','resolution':99999}, [])

    def test_server_syntax(self):
        ast.parse((ROOT/'server.py').read_text(encoding='utf-8'))

if __name__ == '__main__':
    unittest.main()
