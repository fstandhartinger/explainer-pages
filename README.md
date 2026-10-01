# explainer-pages

Hosting for interactive explainer pages (skill `explainer-video-webpage`). `server.js` serves
`/p/<slug>/` from an encrypted bundle and answers `/api/ask` with a Claude model via a
server-side key, rate-limited. Page content is never stored in clear text in this repository.
