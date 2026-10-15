"""Check final-answer extraction without exposing prompts or submitting images."""
import unittest
from unittest.mock import patch
import server


class RefinerResponses(unittest.TestCase):
    original = 'Change the blue circle to red and preserve the background.'
    final = 'Change the circle to red. Preserve the white background.'

    def status(self, text):
        job = {'kind': 'refine', 'intent': 'preview', 'seed': 1,
               'request': {'prompt': self.original}}
        history = {'parent': {'status': {'status_str': 'success'},
                              'outputs': {'34': {'text': text}}}}
        with patch.object(server, 'JOBS', {'parent': job}), \
             patch.object(server, 'comfy', return_value=history):
            return server.generation_status('parent')

    def test_plain_final_answer_is_unchanged(self):
        self.assertEqual(self.status([self.final])['refined_prompt'], self.final)

    def test_closed_thinking_block_is_not_part_of_the_prompt(self):
        reply = '<think>Internal reasoning.</think>\n' + self.final
        self.assertEqual(self.status([reply])['refined_prompt'], self.final)

    def test_template_primed_thinking_without_opening_tag(self):
        reply = 'Internal reasoning.</think>\n' + self.final
        self.assertEqual(self.status([reply])['refined_prompt'], self.final)

    def test_multiple_closing_tags_use_only_final_answer(self):
        reply = '</think>\nInternal reasoning.</think>\n' + self.final
        self.assertEqual(self.status([reply])['refined_prompt'], self.final)

    def test_length_limit_applies_to_final_answer_only(self):
        reply = ('Internal reasoning. ' * 1000) + '</think>' + self.final
        self.assertEqual(self.status([reply])['refined_prompt'], self.final)

    def test_tags_are_case_insensitive(self):
        self.assertEqual(self.status(['Reasoning.</THINK>' + self.final])['refined_prompt'], self.final)

    def test_string_response_is_supported(self):
        self.assertEqual(self.status(self.final)['refined_prompt'], self.final)

    def test_incomplete_thinking_never_becomes_a_prompt(self):
        result = self.status(['<think>Still considering the edit.'])
        self.assertEqual(result['status'], 'error')
        self.assertNotIn('refined_prompt', result)
        self.assertIn('raciocínio', result['error'])

    def test_reasoning_only_or_empty_answer_is_rejected(self):
        for reply in ['Reasoning.</think>', '<think>Reasoning.</think>', '', []]:
            with self.subTest(reply=reply):
                self.assertEqual(self.status(reply)['status'], 'error')

    def test_final_answer_limits_still_apply(self):
        for reply in ['Reasoning.</think>' + 'x' * 12001, 'Reasoning.</think>Change']:
            with self.subTest(chars=len(reply)):
                self.assertEqual(self.status([reply])['status'], 'error')

    def test_invalid_output_is_rejected(self):
        self.assertEqual(self.status([None])['status'], 'error')

    def test_generated_api_response_is_not_used_as_an_image_prompt(self):
        for reply in ['{"status":"completed","output":{"url":"https://example.com/fake.png"},"prompt":"Change the circle."}',
                      '[{"prompt":"Change the circle."}]', '```text\nChange the circle to red.\n```']:
            with self.subTest(reply=reply):
                result = self.status(['</think>\n' + reply])
                self.assertEqual(result['status'], 'error')
                self.assertNotIn('refined_prompt', result)

    def test_literal_original_with_brackets_can_be_preserved(self):
        for original in ['[Change the blue circle to red and preserve the background.]',
                         '{"instruction":"Change the blue circle to red and preserve the background."}']:
            with self.subTest(original=original):
                self.assertEqual(server.extract_refined_prompt(original, original), original)


if __name__ == '__main__':
    unittest.main()
