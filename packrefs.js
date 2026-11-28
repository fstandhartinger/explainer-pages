// Reference-aware page packing (22 Nov 2026, explainer-bundle-fix-1122c). Decides, per page dir, which binary files
// no page text references, so pack.js can leave them out of the encrypted bundle (files stay on disk). Conservative:
// when unsure, keep. Pure functions (no side effects) so test/pack-refs.test.js can drive them.
'use strict';
const fs = require('fs'), path = require('path');

// Text-like files are NEVER excluded (small, loaded by name by players/tools) and form the reference corpus.
const CORPUS_EXT = new Set(['.html', '.htm', '.js', '.mjs', '.cjs', '.css', '.json', '.md', '.txt', '.xml', '.csv', '.map', '.svg', '.yml', '.yaml', '.webmanifest']);
const KEEP_EXT = new Set([...CORPUS_EXT, '.woff', '.woff2', '.ttf', '.otf', '.eot', '.ico']);
const ASSET_EXT = 'png|jpe?g|webp|gif|avif|mp3|m4a|ogg|opus|pdf|svg|json|woff2?|ttf|otf|ico|mp4|webm|wav|js|css|html|md|txt';
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isOrig = (rel) => /\.orig\./.test(path.posix.basename(rel));

function readText(abs) {
  try { return fs.readFileSync(abs, 'latin1'); } catch (_) { return ''; }
}

// Names computed at runtime (string concatenation / template literals) become wildcard rules.
function dynamicRules(corpus) {
  const prefixes = new Set(), regexes = [], exts = new Set();
  let m;
  // "dir/" + x   /   'frame' + n
  const reConcat = /(["'])([A-Za-z0-9_.\/-]{3,80})\1\s*\+/g;
  while ((m = reConcat.exec(corpus))) { const p = m[2].replace(/^\.?\//, ''); if (p.length >= 3) prefixes.add(p); }
  // x + ".png"   (suffix; any directory)
  const reSuffix = /\+\s*(["'])(\.(?:png|jpe?g|webp|gif|avif|mp3|m4a|ogg|svg|pdf))\1/g;
  while ((m = reSuffix.exec(corpus))) exts.add(m[2]);
  // `dir/${i}.png`   `${base}-${n}.webp`
  const reTpl = /`([^`\n]{1,300})`/g;
  while ((m = reTpl.exec(corpus))) {
    const t = m[1]; if (!t.includes('${')) continue;
    const parts = t.split(/\$\{[^}]*\}/);
    const lit = parts.join('');
    if (!/^[A-Za-z0-9_.\/-]*$/.test(lit)) continue;   // path-like templates only (HTML/text templates are not file names)
    if (!/[\/]/.test(lit) && !new RegExp('\\.(?:' + ASSET_EXT + ')\\b', 'i').test(lit)) continue;
    const src = parts.map((x) => esc(x)).join('.*');
    if (parts.every((x) => x === '')) continue;
    try { regexes.push(new RegExp('(^|/)' + src.replace(/^\\\.\\\//, '').replace(/^\//, '') + '$')); } catch (_) {}
  }
  return { prefixes: [...prefixes], regexes, exts: [...exts] };
}

function boundedHas(corpus, token) {
  let i = 0;
  while ((i = corpus.indexOf(token, i)) !== -1) {
    const pre = i === 0 ? '' : corpus[i - 1], post = corpus[i + token.length] || '';
    if (!/[A-Za-z0-9_-]/.test(pre) && !/[A-Za-z0-9_-]/.test(post)) return true;
    i += 1;
  }
  return false;
}

// entries: [{rel, size}] (rel is posix, relative to the page dir); read(rel) -> latin1 text.
// Returns Map rel -> reason for every file to leave out. Everything absent from the map is kept.
function analysePage(entries, read) {
  const exclude = new Map();
  const rels = entries.map((e) => e.rel);
  const corpusParts = [];
  for (const rel of rels) {
    if (!CORPUS_EXT.has(path.posix.extname(rel).toLowerCase()) || isOrig(rel)) continue;
    if (rel === 'copy-tools.js') continue;   // server.js never serves the bundled copy (it answers from its own repo copy)
    corpusParts.push(read(rel));
  }
  const corpus = corpusParts.join('\n');
  const decoded = /%[0-9A-Fa-f]{2}/.test(corpus) ? (() => { try { return decodeURIComponent(corpus); } catch (_) { return corpus; } })() : corpus;
  const hay = decoded === corpus ? corpus : corpus + '\n' + decoded;
  const dyn = dynamicRules(hay);
  const origMentioned = /\.orig\./.test(hay);

  // end-frames/: the only consumer is copy-tools.js, which reads metadata.json scenes[].endFrame.
  let frames = null;
  if (rels.includes('metadata.json')) {
    try {
      const meta = JSON.parse(read('metadata.json'));
      if (Array.isArray(meta.scenes) && meta.scenes.length) frames = new Set(meta.scenes.map((s) => String(s.endFrame || '')));
    } catch (_) { frames = null; }
  }
  const otherFrameMention = frames && rels.some((r) => r !== 'metadata.json' && CORPUS_EXT.has(path.posix.extname(r).toLowerCase()) && !isOrig(r) && /end-?frames/i.test(read(r)));

  for (const e of entries) {
    const rel = e.rel, ext = path.posix.extname(rel).toLowerCase();
    if (KEEP_EXT.has(ext) && !isOrig(rel)) continue;
    const base = path.posix.basename(rel);
    if (rel.startsWith('end-frames/')) {
      // unsure (no usable metadata, or other page code touches end-frames/): keep
      if (!frames || otherFrameMention) continue;
      if (!frames.has(rel)) exclude.set(rel, 'end-frames: not listed in metadata.json');
      continue;
    }
    if (isOrig(rel) && !origMentioned) { exclude.set(rel, 'archive .orig.*: no page text mentions a .orig. path'); continue; }
    const tokens = new Set([rel, base]);
    for (const t of [rel, base]) { try { tokens.add(encodeURI(t)); tokens.add(encodeURIComponent(t)); } catch (_) {} }
    if ([...tokens].some((t) => boundedHas(hay, t))) continue;
    if (isOrig(rel)) { exclude.set(rel, 'archive .orig.*: not referenced by name'); continue; }
    if (dyn.regexes.some((r) => r.test(rel))) continue;
    if (dyn.prefixes.some((p) => rel.startsWith(p) || rel.includes('/' + p) || (p.endsWith('/') ? false : base.startsWith(p)))) continue;
    if (dyn.exts.includes(ext)) continue;
    exclude.set(rel, 'no reference in page text, metadata or computed names');
  }
  return exclude;
}

// Same walk rules as pack.js (QA dirs never served, dotfiles, mp4/wav, symlinks skipped).
function listPage(pageDir) {
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) { if (!/^(stage-check|check|check-live|frames)$/.test(e.name)) walk(p); }
      else if (e.isFile() && !/\.(mp4|wav)$/.test(e.name) && !e.name.startsWith('.')) out.push({ rel: path.relative(pageDir, p).split(path.sep).join('/'), size: fs.statSync(p).size });
    }
  })(pageDir);
  return out;
}

module.exports = { analysePage, listPage, dynamicRules, readText, CORPUS_EXT, KEEP_EXT };
