// Pack pages/<slug>/** into bundle.enc (gzip + AES-256-GCM). Key: env EXPLAINER_BUNDLE_KEY
// (64 hex chars) or ~/.config/explainer-pages/bundle.key. Usage: node pack.js [--dry-run] [--keep-all] [pagesDir] [out]
// Reference-aware (22 Nov 2026, explainer-bundle-fix-1122c): binary files that no page references (see packrefs.js:
// name or path in the page text, metadata.json end frames, computed names) are left out of the bundle; they stay on disk.
//   --dry-run  list what would be excluded (file, bytes, reason; TSV on stdout) and pack nothing
//   --keep-all (or PACK_KEEP_ALL=1)  pack everything, as before
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib'), crypto = require('crypto'), os = require('os');
const { analysePage } = require('./packrefs.js');
const argv = process.argv.slice(2), flags = new Set(argv.filter((a) => a.startsWith('--'))), pos = argv.filter((a) => !a.startsWith('--'));
const dryRun = flags.has('--dry-run'), keepAll = flags.has('--keep-all') || process.env.PACK_KEEP_ALL === '1';
const dir = path.resolve(pos[0] || 'pages'), out = pos[1] || 'bundle.enc';
const keyHex = dryRun ? '' : (process.env.EXPLAINER_BUNDLE_KEY || fs.readFileSync(path.join(os.homedir(), '.config/explainer-pages/bundle.key'), 'utf8')).trim();
const files = {};
// sealed-lane-lechonk-20261114 B2 (R1 M2): symlinks and special files are skipped, regular files are opened with
// O_NOFOLLOW, so a link planted in a page dir can never pull a file from outside pages/ into the public bundle.
function readNoFollow(p) {
  const fd = fs.openSync(p, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try { if (!fs.fstatSync(fd).isFile()) throw new Error(`not a regular file: ${p}`); return fs.readFileSync(fd); }
  finally { fs.closeSync(fd); }
}
const entries = [];   // {key: 'slug/rel', abs, size}
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isSymbolicLink()) { console.error(`pack.js: skipped symlink ${path.relative(dir, p)}`); continue; }
    if (e.isDirectory()) { if (!/^(stage-check|check|check-live|frames)$/.test(e.name)) walk(p); }  // QA screenshots are never served; keeps bundle < GitHub's 100 MiB
    else if (e.isFile() && !/\.(mp4|wav)$/.test(e.name) && !e.name.startsWith('.')) entries.push({ key: path.relative(dir, p).split(path.sep).join('/'), abs: p, size: fs.statSync(p).size });
  }
})(dir);
// Reference-aware exclusion, page by page (a "page" is the first path component; files directly in pagesDir are kept).
const excluded = [];
if (!keepAll) {
  const byPage = new Map();
  for (const e of entries) { const i = e.key.indexOf('/'); if (i < 0) continue; const s = e.key.slice(0, i); if (!byPage.has(s)) byPage.set(s, []); byPage.get(s).push({ rel: e.key.slice(i + 1), size: e.size, abs: e.abs }); }
  const drop = new Set();
  for (const [slug, list] of byPage) {
    const abs = new Map(list.map((x) => [x.rel, x.abs]));
    const ex = analysePage(list, (rel) => { try { return readNoFollow(abs.get(rel)).toString('latin1'); } catch (_) { return ''; } });
    for (const x of list) if (ex.has(x.rel)) { drop.add(slug + '/' + x.rel); excluded.push([slug + '/' + x.rel, x.size, ex.get(x.rel)]); }
  }
  for (let i = entries.length - 1; i >= 0; i--) if (drop.has(entries[i].key)) entries.splice(i, 1);
}
const exBytes = excluded.reduce((a, x) => a + x[1], 0);
if (dryRun) {
  console.log('file\tbytes\treason');
  for (const x of excluded) console.log(x.join('\t'));
  console.error(`pack.js dry-run: ${excluded.length} files, ${(exBytes / 1e6).toFixed(1)} MB would be excluded; ${entries.length} files kept`);
  process.exit(0);
}
if (excluded.length) {
  console.log(`pack.js: left out ${excluded.length} unreferenced files (${(exBytes / 1e6).toFixed(1)} MB raw; files stay on disk); list: ~/.local/state/explainer-pages/pack-excluded.tsv`);
  try {
    const sd = path.join(os.homedir(), '.local/state/explainer-pages'); fs.mkdirSync(sd, { recursive: true });
    fs.writeFileSync(path.join(sd, 'pack-excluded.tsv'), 'file\tbytes\treason\n' + excluded.map((x) => x.join('\t')).join('\n') + '\n');
  } catch (_) {}
}
for (const e of entries) files[e.key] = readNoFollow(e.abs).toString('base64');
const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
// Streamed (same bytes as gzip(JSON.stringify(files))): one JSON string of all pages passed V8's ~512 MB
// string limit on 26 Oct 2026 ("RangeError: Invalid string length").
const gz = zlib.createGzip(), chunks = [];
gz.on('data', (d) => chunks.push(c.update(d)));
gz.on('end', () => {
  const ct = Buffer.concat([...chunks, c.final()]);
  const blob = Buffer.concat([iv, c.getAuthTag(), ct]), PART = 90e6;   // GitHub rejects files > 100 MiB, so ship parts
  for (const f of fs.readdirSync(path.dirname(path.resolve(out)))) if (f.startsWith(path.basename(out))) fs.unlinkSync(path.join(path.dirname(path.resolve(out)), f));
  for (let i = 0; i * PART < blob.length; i++) fs.writeFileSync(`${out}.${i}`, blob.subarray(i * PART, (i + 1) * PART));
  console.log(`packed ${Object.keys(files).length} files -> ${out}.* (${(blob.length / 1e6).toFixed(1)} MB in ${Math.ceil(blob.length / PART)} parts)`);
});
const keys = Object.keys(files);
keys.forEach((k, i) => gz.write((i ? ',' : '{') + JSON.stringify(k) + ':' + JSON.stringify(files[k])));
gz.end(keys.length ? '}' : '{}');
