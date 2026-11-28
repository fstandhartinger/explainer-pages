'use strict';
// node --test test/pack-refs.test.js
const test = require('node:test'), assert = require('node:assert');
const { analysePage } = require('../packrefs.js');
function run(files) {   // files: {rel: text|number(bytes of binary)}
  const entries = Object.entries(files).map(([rel, v]) => ({ rel, size: typeof v === 'number' ? v : v.length }));
  return analysePage(entries, (rel) => (typeof files[rel] === 'string' ? files[rel] : ''));
}
const meta = (frames) => JSON.stringify({ version: 1, scenes: frames.map((f, i) => ({ id: 's' + i, endFrame: f })) });

test('end-frames: only metadata-listed frames are kept (no PNG next to WebP)', () => {
  const ex = run({ 'index.html': '<audio src="audio.mp3">', 'audio.mp3': 5, 'metadata.json': meta(['end-frames/000.webp', 'end-frames/001.webp']),
    'end-frames/000.webp': 9, 'end-frames/001.webp': 9, 'end-frames/000.png': 99, 'end-frames/001.png': 99 });
  assert.deepStrictEqual([...ex.keys()].sort(), ['end-frames/000.png', 'end-frames/001.png']);
});
test('end-frames: missing/broken metadata keeps every frame', () => {
  for (const m of [undefined, '{not json', '{"scenes":[]}']) {
    const f = { 'index.html': 'x', 'end-frames/000.png': 9, 'end-frames/000.webp': 9 }; if (m !== undefined) f['metadata.json'] = m;
    assert.strictEqual(run(f).size, 0, String(m));
  }
});
test('end-frames: another page text that mentions end-frames switches to keep-all', () => {
  const ex = run({ 'index.html': 'x', 'player.js': "fetch('end-frames/' + n + '.png')", 'metadata.json': meta(['end-frames/000.webp']), 'end-frames/000.webp': 9, 'end-frames/007.png': 9 });
  assert.strictEqual(ex.size, 0);
});
test('literal path and basename references keep a file; unreferenced ones go', () => {
  const ex = run({ 'index.html': '<img src="stills/a.jpg"><audio src="audio.mp3">', 'stage.html': '<img src=./b.png>', 'stills/a.jpg': 9, 'audio.mp3': 9, 'b.png': 9, 'c.png': 9, 'audio.v2.mp3': 9, 'sheets/x.png': 9 });
  assert.deepStrictEqual([...ex.keys()].sort(), ['audio.v2.mp3', 'c.png', 'sheets/x.png']);
});
test('names are matched on boundaries (myaudio.mp3 does not keep audio.mp3)', () => {
  const ex = run({ 'index.html': '<audio src="myaudio.mp3">', 'audio.mp3': 9, 'myaudio.mp3': 9 });
  assert.deepStrictEqual([...ex.keys()], ['audio.mp3']);
});
test('URL-encoded references keep a file with spaces', () => {
  assert.strictEqual(run({ 'index.html': '<img src="img/my%20pic.png">', 'img/my pic.png': 9 }).size, 0);
});
test('.orig.* archives: excluded unless some page text mentions a .orig. path', () => {
  assert.deepStrictEqual([...run({ 'index.html': '<audio src=audio.mp3>', 'audio.mp3': 9, 'audio.orig.mp3': 9, 'timeline.orig.json': '{}' }).keys()].sort(), ['audio.orig.mp3', 'timeline.orig.json']);
  assert.strictEqual(run({ 'index.html': '<a href="audio.orig.mp3">', 'audio.orig.mp3': 9 }).size, 0);
});
test('computed names (template literal, concatenation, extension) keep matching files', () => {
  assert.strictEqual(run({ 'app.js': 'img.src = `stills/${i}.jpg`', 'stills/3.jpg': 9, 'stills/4.jpg': 9 }).size, 0);
  assert.strictEqual(run({ 'app.js': "img.src = 'frames-' + id + '.png'", 'frames-a.png': 9 }).size, 0);
  assert.strictEqual(run({ 'app.js': "const u = 'gallery/' + name", 'gallery/q.webp': 9 }).size, 0);
  assert.strictEqual(run({ 'app.js': "load(name + '.mp3')", 'x/y.mp3': 9 }).size, 0);
  assert.deepStrictEqual([...run({ 'app.js': 'img.src = `stills/${i}.jpg`', 'stills/3.jpg': 9, 'other/3.jpg': 9 }).keys()], ['other/3.jpg']);
});
test('text, code, css, fonts and json are never excluded, even unreferenced', () => {
  assert.strictEqual(run({ 'index.html': 'x', 'a.js': '1', 'a.css': '1', 'data.json': '{}', 'notes.md': 'n', 'f.woff2': 9, 'extra/page.html': 'y' }).size, 0);
});
test("the bundled copy-tools.js is not a reference source (server answers from its own copy)", () => {
  const ex = run({ 'index.html': 'x', 'copy-tools.js': "a.download = 'folie-' + id + '.png'", 'p/one.png': 9 });
  assert.deepStrictEqual([...ex.keys()], ['p/one.png']);
});
