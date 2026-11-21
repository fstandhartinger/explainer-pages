import importlib.util
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('reg', ROOT/'scripts/register_artifacts.py')
r = importlib.util.module_from_spec(spec); spec.loader.exec_module(r)

@pytest.fixture
def registry(monkeypatch):
    rows, writes, links = {}, [], []
    def call(*args):
        if args[0] == 'resolve':
            return json.dumps({'items': [{'id': rows[args[1]]}] if args[1] in rows else []})
        if args[0] == 'new':
            value = '%06x' % (len(writes)+1)
            rows[args[args.index('--alias')+1]] = value
            writes.append(args)
            return 'a#' + value
        if args[0] == 'link':
            links.append(args)
            return '{}'
        raise AssertionError(args)
    class Client:
        def upsert(self, data):
            for alias in data.get('aliases', []): rows[alias] = data['id']
    monkeypatch.setattr(r, 'call', call)
    monkeypatch.setitem(sys.modules, 'artifact_cli', SimpleNamespace(Client=Client))
    return rows, writes, links


def page(tmp):
    tmp.mkdir(exist_ok=True)
    (tmp/'points.json').write_text(json.dumps({'page': {'title':'Test'}, 'points':{'intro':{'title':'Intro'}, 'card':{'title':'Card'}}}))
    for name in ['index.html','stage.html']:
        (tmp/name).write_text('<html><body><header></header><section data-scene="intro"><div data-cue="card"></div></section></body></html>')
    return tmp


def test_registration_is_idempotent_and_embeds_watermark(tmp_path, registry):
    src = page(tmp_path/'page')
    assert r.register(src) == '000001'
    first = (src/'stage.html').read_text()
    assert 'a#000001' in first and 'bottom:12px' in first
    assert r.register(src, 'test-aaaaaaaaaa') == '000001'
    assert len(registry[1]) == 3
    assert registry[0]['explainer:test-aaaaaaaaaa#card'] == '000003'
    assert (src/'stage.html').read_text().count('data-xp-video-aid="1"') == 1
    assert json.loads((src/'points.json').read_text())['points']['card']['aid'] == '000003'


def test_retry_recovers_allocation_before_save(tmp_path, registry):
    src = page(tmp_path/'page')
    r.register(src)
    data=json.loads((src/'points.json').read_text()); del data['points']['card']['aid']
    (src/'points.json').write_text(json.dumps(data))
    r.register(src)
    assert len(registry[1]) == 3


def test_republish_reuses_old_ids_and_refuses_conflicts(tmp_path, registry):
    old = page(tmp_path/'old'); r.register(old, 'test-aaaaaaaaaa')
    src = page(tmp_path/'source'); r.register(src, 'test-aaaaaaaaaa', reuse_from=old)
    assert len(registry[1]) == 3
    data=json.loads((src/'points.json').read_text()); data['page']['aid']='ffffff'
    (src/'points.json').write_text(json.dumps(data))
    with pytest.raises(ValueError, match='conflict'): r.register(src, 'test-aaaaaaaaaa', reuse_from=old)


def test_card_bidirectional_link(tmp_path, registry):
    src=page(tmp_path/'page'); (src/'card.json').write_text('{"card_id":19000}')
    registry[0]['card:19000']='abcdef'
    r.register(src)
    assert registry[2] == [('link','000001','explained_by','abcdef'),('link','abcdef','explains','000001')]


def test_retry_failures_keeps_success_count_and_only_retries_failed_pages(tmp_path, registry, monkeypatch):
    sources=tmp_path/'sources';sources.mkdir()
    for name in ['one-aaaaaaaa','two-aaaaaaaa','three-aaaaaaaa']:page(sources/name)
    out=tmp_path/'out';out.mkdir()
    (out/'backfill-receipt.json').write_text(json.dumps({'completed':2,'failures':[{'page':'three-aaaaaaaa','error':'temporary'}]}))
    calls=[];monkeypatch.setattr(r,'register',lambda *args:calls.append(args))
    monkeypatch.setattr(sys,'argv',['register','--pages-root',str(sources),'--output-root',str(out),'--retry-failures'])
    assert r.main()==0
    assert [c[1] for c in calls]==['three-aaaaaaaa']
    assert json.loads((out/'backfill-receipt.json').read_text())=={'completed':3,'failures':[]}
