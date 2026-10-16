# Threat model

Each door into the game: who can use it, what they could gain, what stops them, and the risk that stays (accepted in
writing here). A risk that is not in this file is not accepted: it is a bug.

The assets: the player's device (a tab that must not hang or run foreign code), the player's local data (coins,
bests, picks), the online score lists and the score server host, the published site and its build.

## 1. Replay links and the URL hash

`#replay-<code>`, `#seed-N`, `#debug`: anyone can send such a link.

- **Attacker**: whoever shares a link (chat, a top-10 entry's replay).
- **Gain**: run script in the page (XSS); hang or crash the tab; change the player's records or coins.
- **Controls**: the code is shape-checked with an anchored, bounded pattern before the event scan; every field is
  checked (`decodeReplay`); ticks are capped at `MAX_RUN_TICKS`; an unknown animal makes the link be ignored; animal
  traits are looked up with `Object.hasOwn`; nothing from a link reaches `innerHTML` (text only); the CSP allows
  `script-src 'self'` only. A replay pays no coins and sets no records. `tools/fuzz-replay.mjs` fuzzes the decoder and
  the simulator (CI: 2 minutes per push).
- **Accepted risk**: a link can make the page play any legal run of up to `MAX_RUN_TICKS` (about 2 hours). `#debug`
  shows the test hooks to the person who opens it (they act only on that person's own page).

## 2. The score server (optional, `server/`)

- **Attacker**: any client on the internet.
- **Gain**: fake scores; scores under another player's name; the server down (CPU, memory, disk); a crash.
- **Controls**: body cap 40 KB; name, day, week and mode patterns; a score cap; per-IP (IPv6 per /64) rate limits for
  POST and GET; a global CPU budget for replay checks (503 past it); request and header timeouts; at most 200 entries
  per bucket and 14 days kept; a capped GET cache; atomic file writes; `VERIFY` (on by default) replays every posted run
  with the game's own rules and refuses a score that the run does not reach. `tools/fuzz-server.mjs` fuzzes the HTTP surface,
  `tools/load-server.mjs` loads it. Every reply sends `nosniff` and a CSP that allows nothing. CI runs CodeQL
  (security-extended) on the code and an OWASP ZAP API scan (`server/openapi.yaml`) against a running server on every
  push.
- **Accepted risk**:
  - With `VERIFY=0` a posted score is a claim. The default is on; turn it off only on a private server.
  - A verified run is legal, not human: the rules are public, so a bot can search for a long run offline and post it.
  - A name is not an account: anyone can post as `FROG ABCD`.
  - A replay keeps its rules version (2 or 3, `js/replay.js`) and is checked with those rules, so a run can be posted
    under the older rules. Both are rule sets the game shipped, and the old one is not the easier one: each change in
    version 3 makes a landing or a hop succeed where version 2 failed it (a wider log landing, a hop in from the river
    edge, no fall in the air).
  - Many IP addresses (a botnet) get past the per-IP limits; the global verify budget then answers 503 to everyone for
    up to a minute. Availability gives way so the host stays up.
  - `ALLOW_ORIGIN` is `*` by default: the lists are public, and no cookie or credential is ever sent, so a foreign page
    that posts gains nothing a script could not do directly.

## 3. The POST token (`hop-lanes-token` meta)

- **Attacker**: anyone who reads the page source.
- **Gain**: post scores as if from the page.
- **Controls**: none, by design: the page ships the token, so every visitor has it.
- **Accepted risk**: the token stops only bots that do not read the page. It is not a secret and not authentication.
  `VERIFY` (on by default) is the control for the score itself.

## 4. npm packages and the build

The game ships no npm code at run time except Three.js, built into `vendor/three.min.js` from the pinned `three`
package by the pinned `esbuild`. Every other package is for tests and tools only.

- **Attacker**: a compromised package or a compromised registry release.
- **Gain**: code that runs on a developer machine or in CI (install scripts, test tools); a poisoned
  `vendor/three.min.js` or `hop-lanes-standalone.html` that reaches players.
- **Controls**: exact versions in `package.json`; `package-lock.json` with integrity hashes; `npm ci` in CI; CI rebuilds
  `vendor/three.min.js` and the standalone file and fails on any difference from the committed files; CI scans the lock
  file for known vulnerable versions (OSV-Scanner, `npm audit`).
- **Accepted risk**: a package that is malicious but not yet known as such still runs in CI and on a developer
  machine when it is installed. The CI jobs hold no secrets and a read-only token, which limits what it can take.

## 5. GitHub Actions

- **Attacker**: the author of a pull request from a fork; a compromised third-party action; a moved tag.
- **Gain**: the repository token; write access; a changed live site.
- **Controls**: every action is pinned to a full commit SHA; `permissions: contents: read` by default; checkouts do
  not keep credentials; only the deploy job, only on a push to `main`, gets `pages: write` and `id-token: write`, in
  the `github-pages` environment; pull requests run with `pull_request` (no secrets), never `pull_request_target`.
  zizmor and actionlint check the workflows in CI.
- **Accepted risk**: a push to any branch runs the tests (no secrets, read-only token).

## 6. The live site and its headers (GitHub Pages)

GitHub Pages does not let a site set its own HTTP headers.

- **Attacker**: a network attacker; a page that frames the game.
- **Gain**: changed scripts in transit; clicks tricked through a frame (clickjacking).
- **Controls**: Pages redirects `http://` to `https://`; the CSP in a meta tag (`default-src 'none'`, `script-src 'self'`,
  `connect-src 'none'`, `base-uri 'none'`, `form-action 'none'`, `worker-src 'none'`); no third-party script, style or
  font; no cookies. After each deploy CI grades the live page with the MDN HTTP Observatory (`tools/check-live-site.mjs`)
  and fails on any test this section does not accept. First result (16 Oct 2026): grade C (55); CSP, cookies, CORS,
  COEP, COOP, CORP, redirection, referrer policy and subresource integrity pass.
- **Accepted risk** (each one comes from GitHub Pages: a site cannot set its own headers there):
  - No HSTS. Pages sends no `Strict-Transport-Security`, and `github.io` is not on the browsers' HSTS preload list (this
    file said it was, until the Observatory showed otherwise). The first visit to an `http://` link can be changed by an
    attacker on the network before the redirect. Every later request is HTTPS, and the redirect is the control. The
    fix is a host that sends HSTS (a custom domain behind a CDN that sets headers): the owner's choice.
  - No `X-Content-Type-Options: nosniff`. Every file is the game's own, served with its right type, and nothing is
    uploaded, so there is nothing to sniff into a script.
  - A CSP in a meta tag cannot set `frame-ancestors`, and Pages sends no `X-Frame-Options`: another site can frame the
    game. The game has no account, payment or setting of value outside its own origin, so a framed game can only be
    played.
  - No CSP violation reports (`report-to` does not work from a meta tag).

## 7. Local data (localStorage)

- **Attacker**: the player (or anyone with the device).
- **Gain**: more coins, a higher local best, every animal.
- **Controls**: every read is checked and falls back to a default (`storage.js`); bad JSON is ignored.
- **Accepted risk**: local data is the player's own. It never counts online: the server checks the replay, not the
  local best.

## 8. The offline file (`hop-lanes-standalone.html`)

- **Controls**: every script and style is inline with a hash-based CSP; the build strips every outbound link and tag;
  the smoke test loads it with the network blocked.
- **Accepted risk**: none known.
