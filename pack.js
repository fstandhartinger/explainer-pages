// Pack pages/<slug>/** into bundle.enc (gzip + AES-256-GCM). Key: env EXPLAINER_BUNDLE_KEY
// (64 hex chars) or ~/.config/explainer-pages/bundle.key. Usage: node pack.js [pagesDir] [out]
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib'), crypto = require('crypto'), os = require('os');
const dir = path.resolve(process.argv[2] || 'pages'), out = process.argv[3] || 'bundle.enc';
const keyHex = (process.env.EXPLAINER_BUNDLE_KEY || fs.readFileSync(path.join(os.homedir(), '.config/explainer-pages/bundle.key'), 'utf8')).trim();
const files = {};
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (!/\.(mp4|wav)$/.test(e.name) && !e.name.startsWith('.')) files[path.relative(dir, p).split(path.sep).join('/')] = fs.readFileSync(p).toString('base64');
  }
})(dir);
const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
const ct = Buffer.concat([c.update(zlib.gzipSync(Buffer.from(JSON.stringify(files)))), c.final()]);
fs.writeFileSync(out, Buffer.concat([iv, c.getAuthTag(), ct]));
console.log(`packed ${Object.keys(files).length} files -> ${out} (${(fs.statSync(out).size / 1e6).toFixed(1)} MB)`);
