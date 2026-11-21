/* Shared player controls: prerendered scene ends keep copying independent of playback. */
(() => {
  'use strict';
  if (document.getElementById('xp-copy-tools')) return;
  const viewport = document.getElementById('viewport');
  const media = document.querySelector('video') || document.getElementById('audio') || document.querySelector('audio');
  if (!viewport && !media) return;
  const base = new URL('.', location.href);
  let metadata = null;
  const style = document.createElement('style');
  style.textContent = '#xp-copy-tools{display:inline-flex;align-items:center;gap:5px;flex-wrap:wrap}#xp-copy-tools button,#xp-card{font:500 12px/1.3 system-ui,sans-serif;color:#eee;background:#22222e;border:1px solid #555568;border-radius:999px;padding:7px 10px;cursor:pointer;min-height:34px}#xp-copy-tools button:hover,#xp-card:hover{border-color:#a78bfa}#xp-copy-tools button:focus-visible,#xp-card:focus-visible{outline:2px solid #a78bfa;outline-offset:2px}#xp-copy-tools button:disabled{opacity:.6;cursor:wait}#xp-card{margin:6px 0}#xp-control-card{display:none!important}.xp-large #xp-control-card{display:inline-block!important}#xp-copy-toast{position:fixed;bottom:78px;left:50%;transform:translateX(-50%);z-index:1000;background:#22222e;color:white;border:1px solid #68687c;border-radius:10px;padding:9px 14px;font:14px system-ui;max-width:90vw;pointer-events:none}#controls{flex-wrap:wrap}@media(max-width:600px){#xp-copy-tools button{padding:6px 9px}#xp-copy-tools{margin-top:3px}#controls #scrub{min-width:90px}}';
  document.head.append(style);
  const toast = document.createElement('div');
  toast.id = 'xp-copy-toast'; toast.role = 'status'; toast.setAttribute('aria-live', 'polite'); toast.hidden = true;
  document.body.append(toast);
  let toastTimer;
  function say(text) { (document.fullscreenElement || document.querySelector('.xp-large') || document.body).append(toast); clearTimeout(toastTimer); toast.textContent = text; toast.hidden = false; toastTimer = setTimeout(() => { toast.hidden = true; }, 3500); }
  function scene() {
    const scenes = metadata?.scenes || [];
    const t = media?.currentTime || 0;
    return scenes.find(s => t >= s.start && t < s.end) || (t >= scenes.at(-1)?.end ? scenes.at(-1) : scenes[0]);
  }
  async function copyText(text) {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else {
      const el = document.createElement('textarea'); el.value = text; el.style.position = 'fixed'; el.style.opacity = '0';
      document.body.append(el); el.select();
      const ok = document.execCommand('copy'); el.remove(); if (!ok) throw new Error('copy unavailable');
    }
    say('kopiert');
  }
  const controls = document.createElement('span'); controls.id = 'xp-copy-tools';
  function button(id, label, title, action) {
    const el = document.createElement('button'); el.type = 'button'; el.id = id; el.textContent = label; el.title = title; el.setAttribute('aria-label', title); el.onclick = action; controls.append(el); return el;
  }
  const imageButton = button('xp-copy-frame', '▣ Bild', 'Endbild der aktuellen Folie kopieren (C)', copyFrame);
  button('xp-copy-text', 'T Text', 'Text der aktuellen Folie kopieren', () => {
    const s = scene(); if (!s?.text) return say('Folientext noch nicht verfügbar.');
    copyText(s.text).catch(() => say('Text konnte nicht kopiert werden.'));
  });
  (document.getElementById('controls') || viewport?.parentElement || media.parentElement).append(controls);
  async function png(s) {
    const url = new URL(s.endFrame, base);
    if (url.origin !== base.origin || !/^end-frames\/\d{3}\.png$/.test(s.endFrame)) throw new Error('invalid frame');
    const r = await fetch(url); if (!r.ok) throw new Error('missing frame');
    const blob = await r.blob(); if (blob.type !== 'image/png') throw new Error('invalid image');
    return blob;
  }
  function download(blob, s) {
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = 'folie-' + String(s.id).replace(/[^a-z0-9_-]/gi, '-') + '.png'; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000); say('PNG heruntergeladen – zum Einfügen öffnen.');
  }
  async function copyFrame() {
    if (imageButton.disabled) return;
    const s = scene(); if (!s?.endFrame) return say('Endbild noch nicht verfügbar.');
    imageButton.disabled = true; imageButton.setAttribute('aria-busy', 'true');
    const blobPromise = png(s);
    try {
      if (navigator.clipboard?.write && window.ClipboardItem) {
        // Call write during the click/key gesture, before waiting for the network.
        try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPromise })]); say('Endbild kopiert'); }
        catch (_) { download(await blobPromise, s); }
      } else download(await blobPromise, s);
    } catch (_) { say('Endbild konnte nicht geladen werden. Bitte erneut versuchen.'); }
    finally { imageButton.disabled = false; imageButton.removeAttribute('aria-busy'); }
  }
  function key(e) {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.defaultPrevented) return;
    const target = e.target;
    if (target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]')) return;
    if (e.key.toLowerCase() === 'c') { e.preventDefault(); copyFrame(); }
  }
  addEventListener('keydown', key);
  const frame = document.getElementById('stage');
  function wireFrame() { try { frame.contentWindow.addEventListener('keydown', key); } catch (_) {} }
  if (frame) { frame.addEventListener('load', wireFrame); wireFrame(); }
  fetch(new URL('metadata.json', base)).then(r => r.ok ? r.json() : null).then(m => { metadata = m; }).catch(() => {});
  fetch(new URL('card.json', base), { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(m => {
    const n = Number(m?.card_id); if (!Number.isSafeInteger(n) || n <= 0 || document.getElementById('xp-card')) return;
    const chip = document.createElement('button'); chip.type = 'button'; chip.id = 'xp-card'; chip.textContent = `Karte ${n} ⧉`;
    chip.title = 'Kartennummer kopieren'; chip.onclick = () => copyText(`Karte ${n}`).catch(() => say('Kartennummer konnte nicht kopiert werden.'));
    (document.querySelector('header') || viewport?.parentElement || media.parentElement).append(chip);
    const fullChip = chip.cloneNode(true); fullChip.id = 'xp-control-card'; fullChip.onclick = chip.onclick; controls.prepend(fullChip);
  }).catch(() => {});
})();
