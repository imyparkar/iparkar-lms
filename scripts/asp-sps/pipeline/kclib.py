import json, os

OVL = os.environ.get('ASP_OVERLAYS', 'imports/asp-sps/authoring/overlays')


def sc(code, prompt, options, correct, explanation, why=None, review=None):
    a = {'code': code, 'kind': 'single_choice', 'required': True, 'provenance': 'original',
         'spec': {'prompt': prompt, 'options': [{'id': k, 'text': v} for k, v in options]},
         'answer_key': {'correct': correct}, 'sample_response': {'choice': correct},
         'feedback': {'explanation': explanation, 'options': why or {}}}
    if review:
        a['feedback']['review_section'] = review
    assert correct in [k for k, _ in options], code
    return a


def num(code, prompt, value, unit, tol, explanation, review=None, rel=False, hint=None):
    key = {'value': value, ('rel_tol' if rel else 'abs_tol'): tol}
    note = f"Answers within ±{tol * 100:g}% are accepted." if rel else f"Answers within ±{tol:g}{(' ' + unit) if unit else ''} are accepted."
    a = {'code': code, 'kind': 'numeric', 'required': True, 'provenance': 'original',
         'spec': {'prompt': prompt, 'unit': unit or '(no unit)', 'hint': hint, 'tolerance_note': note},
         'answer_key': key, 'sample_response': {'value': value},
         'feedback': {'explanation': explanation}}
    if review:
        a['feedback']['review_section'] = review
    return a


def save(KC):
    for cid, qs in KC.items():
        p = f'{OVL}/{cid}.json'
        o = json.load(open(p)) if os.path.exists(p) else {}
        o['kc'] = qs
        json.dump(o, open(p, 'w'), ensure_ascii=False, indent=1)
    print('saved kc for', len(KC), 'chapters')
