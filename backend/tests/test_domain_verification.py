from helpers import cat, edit_request, keep, ref, run
from kppb.domain.verification import checklist, judge_prompt, parse_verdicts, score


def test_checklist_and_parsing(library):
    request = edit_request({'face': keep(), 'environment': cat('env.garden'), 'hair': ref('p')},
                           references=(('t', 'alvo'), ('p', 'ref')))
    _, compiled = run(request, library)
    checks = checklist(compiled.blocks)
    ids = [c.id for c in checks]
    assert ids == ['op.environment', 'transfer.2', 'keep']
    assert '[op.environment]' in judge_prompt(checks)
    answer = ('<think>hmm</think>{"results": [{"id": "op.environment", "verdict": "met"}, '
              '{"id": "transfer.2", "verdict": "partial", "note": "close"}, {"id": "keep", "verdict": "bogus"}]}')
    verdicts = parse_verdicts(answer, checks)
    assert [verdicts[i]['verdict'] for i in ids] == ['met', 'partial', 'unknown']
    assert score(verdicts) == 0.5
    assert all(v['verdict'] == 'unknown' for v in parse_verdicts('I refuse', checks).values())
