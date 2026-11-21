// node --test test/  — builds a tiny synthetic encrypted bundle with pack.js and runs server.js against it.
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const KEY = crypto.randomBytes(32).toString('hex'), TOKEN = 'ctx-' + crypto.randomBytes(8).toString('hex');
const A = 'old-page-aaaa1111', B = 'new-page-bbbb2222', C = 'plain-page-cccc3333', D = 'packed-page-dddd4444', E = 'baked-v1-eeee5555';
let tmp, procs = [];

const INDEX_OLD = '<!doctype html><html><body><div id="viewport"><iframe id="stage" src="stage.html"></iframe></div><div id="controls"></div></body></html>';
const w = (slug, name, data) => { fs.mkdirSync(path.join(tmp, 'pages', slug), { recursive: true }); fs.writeFileSync(path.join(tmp, 'pages', slug, name), data); };

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xp-test-'));
  const tl = { title: 'T', lang: 'de', duration: 20, cues: { c1: 1.5, c2: 12 }, scenes: [
    { id: 'intro', start: 0, end: 10, text: 'Erste Szene.' }, { id: 'end', start: 10, end: 20, text: 'Zweite Szene.' }] };
  const pts = { page: { title: 'Titel', lang: 'de' }, points: {
    intro: { title: 'Intro', short: 'kurz', sources: ['Quelle A https://example.com/a'] }, end: { title: 'Ende', short: 'x' },
    c1: { title: 'Karte 1', short: 'k1' }, c2: { title: 'Karte 2', short: 'k2' }, grp: { title: 'Gruppe', short: 'g' }, lost: { title: 'Lost', short: 'l' } } };
  const stage = '<section data-scene="intro"><div data-point="grp"></div></section><section data-scene="end"></section>';
  for (const s of [A, B, D, E]) { w(s, 'timeline.json', JSON.stringify(tl)); w(s, 'points.json', JSON.stringify(pts)); w(s, 'stage.html', stage); }
  w(A, 'index.html', INDEX_OLD);
  w(B, 'index.html', INDEX_OLD.replace('</body>', '<script data-xp-fs="2">/*native*/</script></body>'));
  // a page with the pre-rotation script baked in (marker without a version = 1), plus the word in a comment
  w(E, 'index.html', INDEX_OLD.replace('</body>', '<!-- keep the data-xp-fs marker --><script data-xp-fs>/*v1*/</script></body>'));
  w(C, 'index.html', '<html><body><h1>tweets</h1></body></html>'); w(C, 'points.json', '{}');
  w(D, 'index.html', INDEX_OLD); w(D, 'deepdive.md', '# T\n\n## Eins\ntext\n\n## Herkunft\n- x\n');
  w(D, 'context.json', JSON.stringify({ v: 1, marker: 'packed' }));
  fs.copyFileSync(path.join(ROOT, 'server.js'), path.join(tmp, 'server.js'));
  fs.copyFileSync(path.join(ROOT, 'copy-tools.js'), path.join(tmp, 'copy-tools.js'));
  fs.copyFileSync(path.join(ROOT, 'artifact-badges.js'), path.join(tmp, 'artifact-badges.js'));
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', Buffer.from(KEY, 'hex'), iv);
  const ct = Buffer.concat([c.update(JSON.stringify({ [A]: 18917, 'unknown-page-99999999': 42 })), c.final()]);
  fs.writeFileSync(path.join(tmp, 'cards.enc'), Buffer.concat([iv,c.getAuthTag(),ct]));
  execFileSync('node', [path.join(ROOT, 'pack.js'), path.join(tmp, 'pages'), path.join(tmp, 'bundle.enc')], { env: { ...process.env, EXPLAINER_BUNDLE_KEY: KEY }, stdio: 'pipe' });
});
after(() => { procs.forEach((p) => p.kill()); fs.rmSync(tmp, { recursive: true, force: true }); });

function start(env) {
  return new Promise((resolve, reject) => {
    const port = 20000 + Math.floor(Math.random() * 20000);
    const p = spawn('node', [path.join(tmp, 'server.js')], { env: { ...process.env, PORT: port, EXPLAINER_BUNDLE_KEY: KEY, DESK_URL: 'https://desk.example/', EXPLAINER_CONTEXT_TOKEN: '', ...env }, stdio: ['ignore', 'pipe', 'inherit'] });
    procs.push(p);
    p.on('exit', (c) => reject(new Error('server exited ' + c)));
    p.stdout.on('data', (d) => { if (/explainer-pages on/.test(d)) resolve({ base: `http://127.0.0.1:${port}`, p }); });
  });
}
const get = (base, p, headers) => fetch(base + p, { headers });
let srv, srvNoToken;
before(async () => { srv = await start({ EXPLAINER_CONTEXT_TOKEN: TOKEN }); srvNoToken = await start({}); });

test('fullscreen control is injected exactly once into old pages, never doubled, never into non-explainer pages', async () => {
  const count = async (slug) => { const h = await (await get(srv.base, `/p/${slug}/`)).text(); return [h.split('data-xp-fs').length - 1, h.includes('id="desk-link"')]; };
  assert.deepEqual(await count(A), [1, true]);
  assert.deepEqual(await count(B), [1, true]);        // current (v2) control present → no second copy
  assert.deepEqual(await count(C), [0, true]);        // no #viewport → untouched (desk button as before)
  const raw = await (await get(srv.base, `/p/${A}/?embed=1`)).text();
  assert.ok(!raw.includes('data-xp-fs'), 'embed view stays clean');
});

test('a page with the baked version-1 script gets the current script injected after it, which switches the old one off', async () => {
  const h = await (await get(srv.base, `/p/${E}/`)).text();
  const tags = h.match(/<script\b[^>]*data-xp-fs[^>]*>/g);
  assert.deepEqual(tags, ['<script data-xp-fs>', '<script data-xp-fs="2">']);
  assert.ok(h.indexOf('/*v1*/') < h.indexOf('data-xp-fs="2"'), 'the new script runs after the old one');
  const inj = h.slice(h.indexOf('<script data-xp-fs="2">'));
  assert.match(inj, /data-v', '2'/);
  assert.match(inj, /removeChild\(old\)/, 'removes the old button');
  assert.match(inj, /xp-rot/, 'carries the rotation');
  // the second request does not stack another one
  assert.equal((await (await get(srv.base, `/p/${E}/`)).text()).split('data-xp-fs="2"').length - 1, 1);
});

test('stage.html is served unmodified', async () => {
  const r = await get(srv.base, `/p/${A}/stage.html`);
  assert.equal(await r.text(), fs.readFileSync(path.join(tmp, 'pages', A, 'stage.html'), 'utf8'));
});

test('context files are 404 without or with a wrong token, 200 with the right one', async () => {
  for (const f of ['context.json', 'deepdive.md']) {
    assert.equal((await get(srv.base, `/p/${D}/${f}`)).status, 404, f + ' no token');
    assert.equal((await get(srv.base, `/p/${D}/${f}`, { Authorization: 'Bearer nope' })).status, 404, f + ' wrong token');
    assert.equal((await get(srv.base, `/p/${D}/${f}`, { Authorization: TOKEN })).status, 404, f + ' missing Bearer scheme');
  }
  const ok = await get(srv.base, `/p/${D}/deepdive.md`, { Authorization: `Bearer ${TOKEN}` });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('cache-control'), 'no-store');
  assert.match(ok.headers.get('x-robots-tag'), /noindex/);
  assert.match(await ok.text(), /## Herkunft/);
  assert.equal((await (await get(srv.base, `/p/${D}/context.json`, { Authorization: `Bearer ${TOKEN}` })).json()).marker, 'packed');
});

test('with EXPLAINER_CONTEXT_TOKEN unset nothing is ever served, whatever the header says', async () => {
  for (const auth of [undefined, 'Bearer ', 'Bearer undefined', 'Bearer ' + TOKEN, 'Bearer']) {
    const h = auth === undefined ? undefined : { Authorization: auth };
    assert.equal((await get(srvNoToken.base, `/p/${D}/context.json`, h)).status, 404);
    assert.equal((await get(srvNoToken.base, `/p/${D}/deepdive.md`, h)).status, 404);
  }
});

test('missing deepdive.md / unknown slug → 404 even with the token', async () => {
  const h = { Authorization: `Bearer ${TOKEN}` };
  assert.equal((await get(srv.base, `/p/${A}/deepdive.md`, h)).status, 404);
  assert.equal((await get(srv.base, `/p/nonexist-slug-0000/context.json`, h)).status, 404);
});

test('context.json is derived for a page without one', async () => {
  const r = await get(srv.base, `/p/${A}/context.json`, { Authorization: `Bearer ${TOKEN}` });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const c = await r.json();
  assert.equal(c.v, 1); assert.equal(c.slug, A); assert.equal(c.title, 'Titel'); assert.equal(c.lang, 'de'); assert.equal(c.duration, 20);
  assert.deepEqual(c.scenes.map((s) => [s.id, s.start, s.end, s.title, s.text]), [['intro', 0, 10, 'Intro', 'Erste Szene.'], ['end', 10, 20, 'Ende', 'Zweite Szene.']]);
  assert.deepEqual(c.scenes[0].points, ['intro', 'c1', 'grp']);
  assert.deepEqual(c.scenes[1].points, ['end', 'c2']);
  assert.equal(c.elements.c1.scene, 'intro'); assert.equal(c.elements.c1.t, 1.5);
  assert.equal(c.elements.c2.scene, 'end');
  assert.equal(c.elements.grp.scene, 'intro');           // no cue: found in stage.html
  assert.equal(c.elements.lost.scene, null);
  assert.equal(c.elements.intro.scene, 'intro');
  assert.deepEqual(c.deepdive, { chars: 0, sections: [] });
  assert.deepEqual(c.sources, [{ label: 'Quelle A', ref: 'https://example.com/a' }]);
});

// Public metadata follows the same unlisted/noindex boundary as its player; never a listing.
test('encrypted card sidecar serves known pages only, no-store and noindex', async () => {
  const r = await get(srv.base, `/p/${A}/card.json`);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), {card_id:18917});
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.match(r.headers.get('x-robots-tag'), /noindex/);
  assert.equal((await get(srv.base, '/p/unknown-page-99999999/card.json')).status,404);
  assert.equal((await get(srv.base, '/cards.enc')).status,404);
});
test('old pages receive copy controls once, shared script has a JavaScript content type', async () => {
  const h = await (await get(srv.base, `/p/${A}/`)).text();
  assert.equal(h.split('data-xp-copy="1"').length-1,1);
  const r = await get(srv.base, '/copy-tools.js');
  assert.equal(r.status,200);
  assert.match(r.headers.get('content-type'), /javascript/);
  assert.match(await r.text(), /ClipboardItem/);
  assert.equal(await (await get(srv.base, `/p/${A}/copy-tools.js`)).text(), fs.readFileSync(path.join(ROOT,'copy-tools.js'),'utf8'));
});

test('malformed encoded page paths return 400 and the server stays healthy', async () => {
  assert.equal((await get(srv.base, `/p/${A}/%E0%A4%A`)).status,400);
  assert.equal((await get(srv.base,'/healthz')).status,200);
});

test('artifact badge runtime is injected once and served', async () => {
 const h = await (await get(srv.base, `/p/${A}/`)).text();
 assert.equal(h.split('src="/artifact-badges.js"').length - 1, 1);
 const js = await (await get(srv.base, '/artifact-badges.js')).text();
 assert.ok(js.includes('b3f477'));
});
