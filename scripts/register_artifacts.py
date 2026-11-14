#!/usr/bin/env python3
"""Register explainer IDs before capture/publish; backfill into an isolated output tree.

Only registry-allocated IDs are accepted. A source alias recovers an allocation if a
process stops before saving points.json. Persist each allocation before proceeding.
"""
from concurrent.futures import ThreadPoolExecutor, as_completed
import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

APP_ID = 'b3f477'
CLI = str(Path.home() / 'bin/artifact')
BADGES = Path(__file__).resolve().parents[1] / 'assets' / 'artifact-badges.js'
HEX = re.compile(r'^(?:a#)?([0-9a-f]{6})$')


def aid(value):
    m = HEX.fullmatch(value or '')
    return m[1] if m else None


def call(*args):
    p = subprocess.run([CLI, *map(str, args)], capture_output=True, text=True, timeout=20)
    if p.returncode:
        raise RuntimeError('artifact command failed: ' + p.stderr[:200])
    return p.stdout.strip()


def save(path, data):
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    os.replace(tmp, path)


def ensure_id(stored, alias, kind, parent, source, slug):
    if aid(stored):
        return aid(stored)
    result = json.loads(call('resolve', alias, '--json', '--depth', '0'))
    rows = result.get('items', [])
    if rows:
        return aid(rows[0]['id'])
    args = ['new', '--kind', kind, '--surface', 'app:explainer-pages',
            '--title', 'Erklärseite' if kind == 'page' else 'Erklärpunkt',
            '--summary', ('Diese Seite erklärt ein Thema als Video und interaktive Punkte. '
                          'Die Punkte öffnen zusätzliche Erläuterungen.' if kind == 'page' else
                          'Dieser Punkt erläutert einen Teil der Erklärseite. Er lässt sich in der Animation oder im Kapitel auswählen.'),
            '--parent', parent, '--access', 'private', '--alias', alias,
            '--ref', 'file=' + str(source / 'points.json')]
    parts = source.parts
    if 'jobs' in parts:
        args += ['--ref', 'job=job:' + parts[parts.index('jobs') + 1]]
    if slug:
        args += ['--url', 'https://explainers.app.mintapis.com/p/' + slug + '/']
    value = aid(call(*args))
    if not value:
        raise ValueError('registry did not return an ID')
    return value


def decorate(path, script, marker):
    text = path.read_text()
    pattern = re.compile(r'<script data-xp-' + marker + r'="1">.*?</script>', re.S)
    tag = '<script data-xp-' + marker + '="1">' + script + '</script>'
    if pattern.search(text):
        text = pattern.sub(lambda _: tag, text)
    elif '</body>' in text:
        text = text.replace('</body>', tag + '</body>', 1)
    else:
        text += tag
    path.write_text(text)


def register(page, slug=None, source=None, reuse_from=None):
    page = Path(page).resolve()
    source = Path(source or page).resolve()
    with (page / '.artifact-register.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        file = page / 'points.json'
        data = json.loads(file.read_text())
        info = data.setdefault('page', {})
        if reuse_from and (Path(reuse_from) / 'points.json').exists():
            old = json.loads((Path(reuse_from) / 'points.json').read_text())
            for fresh, prior in [(info, old.get('page', {}))] + [(p, old.get('points', {}).get(k, {})) for k, p in data.get('points', {}).items()]:
                if aid(prior.get('aid')):
                    if aid(fresh.get('aid')) and aid(fresh['aid']) != aid(prior['aid']):
                        raise ValueError('source/published artifact ID conflict; reconcile before publishing')
                    fresh['aid'] = aid(prior['aid'])
        slug = slug or info.get('artifact_slug')
        # Pre-render source aliases are unique even when every job calls its directory "page".
        base = 'explainer:' + slug if slug else 'explainer-source:' + str(source)
        info['aid'] = ensure_id(info.get('aid'), base, 'page', APP_ID, source, slug)
        if slug:
            info['artifact_slug'] = slug
        save(file, data)
        for key, point in data.get('points', {}).items():
            point['aid'] = ensure_id(point.get('aid'), base + '#' + key, 'element', info['aid'], source, slug)
            save(file, data)
        # Publish adds canonical slug aliases to pre-render allocations as well.
        if slug:
            sys.path.insert(0, str(Path.home() / 'bin'))
            from artifact_cli import Client
            client = Client()
            for key, value in [(None, info)] + list(data.get('points', {}).items()):
                client.upsert({'id': value['aid'], 'aliases': ['explainer:' + slug + ('#' + key if key else '')],
                               'url': 'https://explainers.app.mintapis.com/p/' + slug + '/'})
        script = (BADGES if BADGES.exists() else Path(__file__).resolve().parents[1] / 'artifact-badges.js').read_text()
        decorate(page / 'index.html', script, 'aids')
        decorate(page / 'stage.html', script, 'aids')
        # Inline and synchronous: deterministic frame capture sees this before its first frame.
        watermark = """(() => {const b=document.createElement('span');b.textContent='a#%s';b.dataset.pageAid='%s';b.style.cssText='position:fixed;right:18px;bottom:12px;font:14px monospace;color:#b7c0ce;opacity:.55;z-index:2147483646;pointer-events:none';document.body.appendChild(b)})();""" % (info['aid'], info['aid'])
        decorate(page / 'stage.html', watermark, 'video-aid')
        link_card(page, info['aid'])
        return info['aid']


def link_card(page, page_id):
    card_file = page / 'card.json'
    if not card_file.exists():
        return
    card = json.loads(card_file.read_text())
    card_id = aid(card.get('aid'))
    if not card_id and isinstance(card.get('card_id'), int) and card['card_id'] > 0:
        rows = json.loads(call('resolve', 'card:' + str(card['card_id']), '--depth', '0')).get('items', [])
        card_id = aid(rows[0]['id']) if rows else None
    if card_id:
        call('link', page_id, 'explained_by', card_id)
        call('link', card_id, 'explains', page_id)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('page', nargs='?')
    p.add_argument('--slug')
    p.add_argument('--source')
    p.add_argument('--reuse-from', type=Path)
    p.add_argument('--link-card-only', action='store_true')
    p.add_argument('--pages-root', type=Path)
    p.add_argument('--output-root', type=Path)
    p.add_argument('--retry-failures', action='store_true')
    args = p.parse_args()
    if args.pages_root:
        if not args.output_root or args.output_root.resolve() == args.pages_root.resolve():
            p.error('backfill requires a separate --output-root (never edits published sources)')
        failures = []
        count = 0
        def backfill(src):
            dst = args.output_root / src.name
            dst.mkdir(parents=True, exist_ok=True)
            # Reuse previous output IDs on retries, including a partially completed backfill.
            for name in ['points.json', 'index.html', 'stage.html', 'card.json']:
                if (src / name).exists() and not (dst / name).exists():
                    shutil.copy2(src / name, dst / name)
            register(dst, src.name, src)
        sources = [s for s in sorted(args.pages_root.iterdir()) if s.is_dir() and (s / 'points.json').exists()]
        if args.retry_failures:
            previous = json.loads((args.output_root / 'backfill-receipt.json').read_text())
            count = previous['completed']
            retry = {item['page'] for item in previous['failures']}
            sources = [s for s in sources if s.name in retry]
        # Bounded I/O concurrency only, not agent delegation. Every page has its own file lock.
        with ThreadPoolExecutor(max_workers=4) as pool:
            pending = {pool.submit(backfill, src): src for src in sources}
            for future in as_completed(pending):
                src = pending[future]
                try:
                    future.result()
                    count += 1
                except Exception as e:
                    failures.append({'page': src.name, 'error': str(e)[:200]})
                save(args.output_root / 'backfill-receipt.json', {'completed': count, 'failures': failures})
        save(args.output_root / 'backfill-receipt.json', {'completed': count, 'failures': failures})
        print(json.dumps({'completed': count, 'failed': len(failures)}))
        return bool(failures)
    if not args.page:
        p.error('page directory required')
    if args.link_card_only:
        page = Path(args.page)
        info = json.loads((page / 'points.json').read_text()).get('page', {})
        if aid(info.get('aid')):
            link_card(page, info['aid'])
    else:
        print('a#' + register(args.page, args.slug, args.source, args.reuse_from))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
