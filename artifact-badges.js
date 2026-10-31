/* IDs come only from points.json, populated by register_artifacts.py. */
(() => {
  const APP_ID = 'b3f477'; // Registry-allocated explainer app; validate through badge().
  const valid = id => typeof id === 'string' && /^[0-9a-f]{6}$/.test(id);
  const badge = (node, id) => {
    if (!node || !valid(id)) return;
    const svg = node.namespaceURI === 'http://www.w3.org/2000/svg';
    let box, transform;
    if (svg) {
      try { box = node.getBBox(); } catch (_) { return; }
      if (!['svg', 'g'].includes(node.localName)) { transform = node.getAttribute('transform'); node = node.parentElement; }
    }
    if (node.querySelector(`:scope > .aid[data-aid="${id}"]`)) return;
    if (!svg && getComputedStyle(node).position === 'static') node.style.position = 'relative';
    if (node.matches('#chapters a')) node.style.paddingRight = '88px';
    const b = svg ? document.createElementNS('http://www.w3.org/2000/svg', 'text') : document.createElement('span');
    b.setAttribute('class', 'aid'); b.dataset.aid = id; b.textContent = 'a#' + id;
    b.setAttribute('title', 'Artefakt-ID – klicken zum Kopieren'); b.tabIndex = 0; b.role = 'button';
    b.style.cssText = 'position:absolute;right:8px;top:4px;font:11px monospace;opacity:.55;cursor:pointer;z-index:20;text-transform:none;letter-spacing:normal';
    if (svg) { b.setAttribute('x', box.x + box.width - 80); b.setAttribute('y', box.y + 12); b.setAttribute('fill', '#b7c0ce'); if (transform) b.setAttribute('transform', transform); }
    const copy = e => { e.stopPropagation(); e.preventDefault(); navigator.clipboard?.writeText('a#' + id).catch(() => {}); };
    b.addEventListener('click', copy); b.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') copy(e); });
    node.appendChild(b);
  };
  fetch('points.json').then(r => r.json()).then(data => {
    const stage = /(?:^|\/)stage\.html$/.test(location.pathname);
    if (stage) {
      if (!new URLSearchParams(location.search).has('interactive')) return;
      document.querySelectorAll('[data-point],[data-cue],[data-scene]').forEach(el => {
        const key = el.dataset.point || el.dataset.cue || el.dataset.scene;
        badge(el, data.points?.[key]?.aid);
      });
    } else {
      const header = document.querySelector('header') || document.body;
      badge(header, data.page?.aid);
      const app = document.createElement('div'); app.style.cssText = 'position:relative;height:22px';
      header.appendChild(app); badge(app, APP_ID);
      const refresh = () => {
        document.querySelectorAll('#chapters [data-id]').forEach(el => badge(el, data.points?.[el.dataset.id]?.aid));
        const title = document.querySelector('#explain h2');
        const matches = Object.values(data.points || {}).filter(p => p.title === title?.textContent);
        if (matches.length === 1) badge(title.parentElement, matches[0].aid);
      };
      // Ignore our own inserted badges, so chapter/caption updates cannot cause a mutation loop.
      new MutationObserver(records => { if (records.some(r => [...r.addedNodes].some(n => n.nodeType === 1 && !n.matches?.('.aid')))) refresh(); })
        .observe(document.body, { childList: true, subtree: true });
      refresh();
    }
  }).catch(() => {});
})();
