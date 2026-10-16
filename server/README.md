# Hop Lanes score server (optional)

Dependency-free Node 20 server for an online top-10 list.

    node server/scores.mjs

| Env | Default | Meaning |
|-----|---------|---------|
| `PORT` | `8787` | listen port |
| `DATA_FILE` | `server/scores.json` | JSON store (see limits below) |
| `ALLOW_ORIGIN` | `*` | CORS `Access-Control-Allow-Origin`; set it to the game origin in production |
| `POST_TOKEN` | empty | when set, POSTs must send it in the `X-Hop-Token` header |
| `MAX_SCORE` | `5000` | highest accepted score (override is meant for tests) |
| `RATE_MAX` | `10` | POSTs per minute per client (override is meant for tests); past it 429 |
| `GET_RATE_MAX` | `60` | GETs per minute per client; past it 429 with `Retry-After: 60` |
| `TRUST_PROXY` | unset | set to `1` behind a reverse proxy or TLS terminator: the rate limit then keys on the last `X-Forwarded-For` hop instead of the socket address (without it, every player behind the proxy shares one budget); a hop that is not an IP address (a forged header) keys on the socket |
| `VERIFY` | unset | set to `1` to check every posted score by replaying the run (see below) |
| `VERIFY_MS` | `300` | wall-clock budget for replaying one run (the replay blocks the event loop, so keep it short); a run that takes longer is rejected |
| `VERIFY_BUDGET_MS` | `20000` | simulation wall time allowed per minute for the whole server, all clients together; once spent, a POST is answered `503 {"error":"busy"}` with `Retry-After` (seconds) instead of being replayed |
| `SAVE_DELAY_MS` | `1000` | accepted POSTs are written to disk at most this often (asynchronously, to a temp file then renamed), and on exit (`0` writes at once, synchronously) |

## Endpoints

    curl http://localhost:8787/scores
    # {"top":[{"name":"Ann","score":120,"at":"2026-01-01T00:00:00.000Z","day":null,"mode":"classic"}]}

    curl -X POST http://localhost:8787/scores \
      -H 'Content-Type: application/json' -d '{"name":"Ann","score":120}'

Per-day and weekly boards: POST may also carry `day` (string `YYYY-MM-DD`) and `mode` (one of `MODES` in js/rules.js: `classic`, `race`, `coinwar`, `tag`, `daily` or `room`). Both are optional and stored on the entry; missing means `day: null`, `mode: "classic"`. Top entries in every response include `day`, `mode` and `replay` (the stored replay code, or `null`). `GET /scores?day=YYYY-MM-DD` returns the top 10 of that day (any mode); add `&mode=daily` to filter by both. `GET /scores?week=YYYY-Www` (ISO 8601 week, Monday to Sunday, e.g. `2026-W42`) returns the top 10 of entries whose `day` falls in that week (any mode; `&mode=` filters as with `day`; entries without a `day` never match). `day` and `week` together is 400, as is a malformed `week`. With no query it is the all-time top 10 of all entries. A malformed `day` or `week` or unknown `mode`, in a POST body or in the query, returns 400.

    curl 'http://localhost:8787/scores?day=2026-01-01&mode=daily'
    # {"top":[{"name":"Ann","score":120,"at":"2026-01-01T00:00:00.000Z","day":"2026-01-01","mode":"daily","replay":null}]}

    curl 'http://localhost:8787/scores?week=2026-W01&mode=daily'

POST rules: name 1-16 chars (letters, digits, spaces), score integer 0..5000 (`MAX_SCORE`; 5001 gets 400), `day` no later than tomorrow (UTC), body at most 40 KB, 10 POSTs/min per IP (429 after that). IPv6 clients are limited per /64. If `POST_TOKEN` is set, POST must carry the header `X-Hop-Token` with that value (compared in constant time), else 401 `{"error":"bad token"}` (checked before the rate limit, so junk posts do not use up the budget); GET is unaffected. Bad input returns 400, other paths 404.

Replays: the game posts `replay`, the code of its replay link (`js/replay.js`: seed, mode, animals, handicap, the world tick play began on and every hop with its tick). Without `VERIFY` the field is optional and only checked for shape (a string of at most 32768 URL-safe base64 characters, else 400; without `VERIFY` a code that does not decode as a replay is stored as `null`). Either way an accepted replay is stored on the entry and returned as `replay` on every top entry of every GET (at most 10 per response, so bodies stay small; an entry without one has `replay: null`). The POST reply's `top` entries leave `replay` out. Only the top 10 of each bucket keep their replay: an entry pushed to rank 11 or lower has it cleared. A higher score from the same name replaces the entry and its replay; so a bucket's file holds at most 10 replays of up to 32 KB. With `VERIFY=1` every POST must carry it, and the server plays the run again with `js/sim.js` (the game's own rules, no browser): the score must equal the higher score the replay plays to, the replay's mode must equal `mode`, and a `daily` run must be on that day's world (seed `dailySeedFor(day)` from `js/rules.js`, as the game's `dailySeed()`); classic, race and room runs may be on any seed. Anything else is 400 `{"error":"replay mismatch"}`. A replay is at most an hour of play; the simulation costs about 1 µs per game tick once the server is warm (a 5-minute run is ~40 ms, an hour ~0.4 s) and is cut off after `VERIFY_MS`. The run must also end within `(score + 10) x 20` seconds of play (`maxTicks = min(1 hour, (score + 10) x 120 x 20)`); a run that does not is rejected like a mismatch. Replaying is synchronous: with `VERIFY` keep `RATE_MAX` low; `VERIFY_BUDGET_MS` caps the total simulation time per minute whatever the clients. The server imports `../js/rules.js`, `../js/gen.js`, `../js/sim.js` and `../js/replay.js`, so deploy it next to the game's `js/` folder.

This proves the score fits the hops, not that a person made the hops: a bot can still play the game. It stops edited scores and made-up runs that do not play out.

Storage limits, so a flood of fake scores cannot wipe the board:

- A bucket is `mode|day` (day empty when absent). Each bucket keeps at most 200 entries (the highest); other buckets are untouched.
- One entry per name per bucket. A new post for an existing name replaces it only if its score is higher; otherwise it is ignored (still 200).
- Day buckets more than 14 days older than the newest day seen are dropped, so the file cannot grow forever. Buckets without a day never expire.
- An old `scores.json` (flat array) loads as is and is compacted by these rules on start.

## Wiring the game

`index.html` must allow the server origin in its Content-Security-Policy `connect-src`, and point at it:

    <meta name="hop-lanes-scores" content="https://your-server/scores">

To pass the token, add:

    <meta name="hop-lanes-token" content="your-token">

The page is public, so anyone can read the token: it stops drive-by bots, not a determined person.

What the game sends: `name` is the character name plus a 4-character tag the device picks once (for example `FROG 7K2Q`), so the one-entry-per-name rule keeps one score per device and character; `day` is the player's local date; `mode` is the mode played. The token is in the page (`<meta name="hop-lanes-token">`), so it stops casual scripts, not a determined one.
