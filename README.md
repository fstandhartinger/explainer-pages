# explainer-pages

Hosting for interactive explainer pages (skill `explainer-video-webpage`). `server.js` serves
`/p/<slug>/` from an encrypted bundle and answers `/api/ask` with a Claude model via a
server-side key, rate-limited. Page content is never stored in clear text in this repository.

### Copy controls (29 Oct 2026)
Every standard player receives `copy-tools.js` at serve time. Its header chip copies
`Karte <Telegram message id>`; the compact Bild button and `C` copy the current
scene's final 1920×1080 PNG without seeking or pausing playback. Text copies the scene
heading and visible slide text. Unsupported/denied image clipboard writes download
the same PNG. Controls also work in fullscreen; typing C in a text field is ignored.

The shared explainer skill's `capture_end_frames.sh` runs deterministic `seekTo(end)`
on LeChonk before publish, excluding the scene-container fade at the cut. It writes
`metadata.json` and `end-frames/NNN.png`; these are encrypted with the other page assets.
`card.json` is overlaid from the small AES-GCM-encrypted `cards.enc` index. The notify
successful-send hook queues `sync_cards.py --publish` under the existing publisher lock,
so a Telegram id is added after sending, without repacking the video bundle. The helper
retries commit/push/deploy independently and records success only after HTTPS readback.
No listing or new public write endpoint is exposed. Pages and metadata remain noindex.

Artifact IDs are allocated by `scripts/register_artifacts.py` at generation time and stored in
`points.json` (`page.aid`, `points.<point>.aid`). The player and interactive stage display copyable
badges; deterministic video capture retains the page ID in the lower right. Existing pages can
be backfilled into an isolated review directory with `--pages-root ... --output-root ...`.
The generator also lives with the explainer-video-webpage skill, which invokes it before render
and publish. Registry and card relationships use source references rather than copied context.
The app manifest is `artifacts.manifest.json`; generated page IDs stay in the encrypted bundle.

Run server regressions with `node --test test/server.test.js` and generator regressions with
`python3 -m pytest -q test/test_artifacts.py`.
