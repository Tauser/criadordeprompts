import json

import pytest

from helpers import cat, edit_request, keep, ref, run
from prisma_studio.domain.verification import Check, checklist, judge_prompt, parse_verdicts, score


def test_checklist_and_parsing(library):
    request = edit_request({'face': keep(), 'environment': cat('env.garden'), 'hair': ref('p')},
                           references=(('t', 'alvo'), ('p', 'ref')))
    _, compiled = run(request, library)
    checks = checklist(compiled.blocks)
    assert checks[-1].id == 'faces'                  # every edit has a person whose face is judged
    checks = checks[:-1]
    ids = [c.id for c in checks]
    assert ids == ['op.environment', 'transfer.2', 'keep']
    assert '[op.environment]' in judge_prompt(checks)
    answer = ('<think>hmm</think>{"results": [{"id": "op.environment", "verdict": "met"}, '
              '{"id": "transfer.2", "verdict": "partial", "note": "close"}, {"id": "keep", "verdict": "bogus"}]}')
    verdicts = parse_verdicts(answer, checks)
    assert [verdicts[i]['verdict'] for i in ids] == ['met', 'partial', 'unknown']
    assert score(verdicts) == 0.5
    assert all(v['verdict'] == 'unknown' for v in parse_verdicts('I refuse', checks).values())


def test_complete_numbered_results_are_mapped_by_id_not_response_order():
    checks = [Check('op.environment', 'A blue background'), Check('op.wardrobe', 'A blue shirt')]
    answer = json.dumps({'results': [{'id': '2', 'verdict': 'met'}, {'id': 1, 'verdict': 'unmet'}]})
    verdicts = parse_verdicts(answer, checks)
    assert verdicts['op.environment']['verdict'] == 'unmet'
    assert verdicts['op.wardrobe']['verdict'] == 'met'
    assert score(verdicts) == 0.5


@pytest.mark.parametrize('ids', [['1'], ['1', '1'], ['1', '3'], ['0', '1']])
def test_ambiguous_numbered_results_remain_unknown(ids):
    checks = [Check('op.environment', 'A blue background'), Check('op.wardrobe', 'A blue shirt')]
    answer = json.dumps({'results': [{'id': key, 'verdict': 'met'} for key in ids]})
    assert all(v['verdict'] == 'unknown' for v in parse_verdicts(answer, checks).values())


def test_mixed_numbered_and_named_results_do_not_guess_the_missing_id():
    checks = [Check('op.environment', 'A blue background'), Check('op.wardrobe', 'A blue shirt')]
    answer = json.dumps({'results': [{'id': 'op.environment', 'verdict': 'met'}, {'id': '2', 'verdict': 'met'}]})
    verdicts = parse_verdicts(answer, checks)
    assert verdicts['op.environment']['verdict'] == 'met'
    assert verdicts['op.wardrobe']['verdict'] == 'unknown'


def test_judge_prompt_has_only_named_ids_without_competing_ordinals():
    prompt = judge_prompt([Check('op.environment', 'A blue background')])
    assert prompt == 'Checklist:\n[op.environment] A blue background'


def test_ids_copied_with_brackets_are_accepted():
    from prisma_studio.domain.verification import Check, parse_verdicts
    checks = [Check('op.environment', 'q1'), Check('guide.gaze', 'q2')]
    answer = '{"results": [{"id": "[op.environment]", "verdict": "met"}, {"id": " [guide.gaze] ", "verdict": "partial"}]}'
    verdicts = parse_verdicts(answer, checks)
    assert verdicts['op.environment']['verdict'] == 'met' and verdicts['guide.gaze']['verdict'] == 'partial'


def test_pose_check_lets_the_arms_follow_an_action(library):
    from helpers import cat, generate_request, run
    from prisma_studio.domain.verification import checklist
    compiled = run(generate_request({'pose': cat('pose.seated'), 'action': cat('action.read')}), library)[1]
    pose = next(c for c in checklist(compiled.blocks) if c.id == 'op.pose')
    assert pose.question.endswith('(the arms and hands may follow the action instead)')
