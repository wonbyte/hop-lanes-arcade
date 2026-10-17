# Hop Lanes score server (optional)

Dependency-free Node 20 server for an online top-10 list.

    node server/scores.mjs

| Env | Default | Meaning |
|-----|---------|---------|
| `PORT` | `8787` | listen port |
| `DATA_FILE` | `server/scores.json` | JSON store of the entries without a day (see storage below) |
| `DAYS_DIR` | `DATA_FILE` without `.json`, plus `.days` (`server/scores.days`) | one JSON file per day (`YYYY-MM-DD.json`) |
| `ALLOW_ORIGIN` | `*` | CORS `Access-Control-Allow-Origin`. **Set it to the game's origin in production** (for example `https://wonbyte.github.io`): then a POST whose `Origin` header names any other site is refused with 403 (a POST without `Origin` is not a browser's cross-site request and passes) |
| `POST_TOKEN` | empty | when set, POSTs must send it in the `X-Hop-Token` header |
| `MAX_SCORE` | `5000` | highest accepted score (override is meant for tests) |
| `RATE_MAX` | `10` | POSTs per minute per client (override is meant for tests); past it 429 |
| `GET_RATE_MAX` | `60` | GETs per minute per client; past it 429 with `Retry-After: 60` |
| `TRUST_PROXY` | unset | set to `1` behind a reverse proxy or TLS terminator: the rate limit then keys on the last `X-Forwarded-For` hop instead of the socket address (without it, every player behind the proxy shares one budget); a hop that is not an IP address (a forged header) keys on the socket |
| `VERIFY` | on | every posted score is checked by replaying the run (see below); `0` turns the check off (then a posted score is only a claim) |
| `VERIFY_MS` | `300` | wall-clock budget for replaying one run (the replay blocks the event loop, so keep it short); a run that takes longer is answered `503 {"error":"busy: the replay check ran out of time"}` with `Retry-After: 30` (the server was slow, the run is not wrong) |
| `VERIFY_BUDGET_MS` | `20000` | simulation wall time allowed per minute for the whole server, all clients together; once spent, a POST is answered `503 {"error":"busy"}` with `Retry-After` (seconds) instead of being replayed |
| `VERIFY_CLIENT_MS` | `5000` | the same for one client (an IPv4 address, or an IPv6 /56: what one subscriber may hold), so one client cannot spend the whole budget; past it `429` with `Retry-After` |
| `MIN_RULES` | `RULES` of `js/rules.js` (4) | the oldest rules version a posted replay may be played with; an older one is `400 {"error":"old rules: replay version 2, this server takes 3 or newer"}`. Old links and ghosts still play in the game: this is only for new posts |
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

POST rules, in this order: the body must be `Content-Type: application/json` (a charset parameter is fine; anything else is 415: a `text/plain` or form POST is a CORS simple request any page could send without a preflight); with `ALLOW_ORIGIN` set, an `Origin` header naming another site is 403; if `POST_TOKEN` is set, POST must carry the header `X-Hop-Token` with that value (compared in constant time), else 401 `{"error":"bad token"}` (checked before the rate limit, so junk posts do not use up the budget); 10 POSTs/min per client (429 with `Retry-After: 60` after that); then the body: at most 40 KB, name 1-16 chars (letters, digits, spaces), score integer 0..5000 (`MAX_SCORE`; 5001 gets 400), `day` the player's date: the server's UTC date or the day before or after (time zones), else 400 `{"error":"day out of range: ..."}`. A replay, when there is one (VERIFY or not): rules `MIN_RULES` or newer, no handicap shield (400 `{"error":"handicap runs are not ranked"}`: the shield helps a younger player, it is not a ranked run), every joined animal one of the game's (400 `unknown animal`). GET is unaffected by the token. Bad input returns 400, other paths 404. A client is an IPv4 address or an IPv6 /64 (the address is expanded to its 8 groups first, so `2001::7:1:2:3:4` is `2001:0:0:7::/64`; an IPv4-mapped `::ffff:a.b.c.d` is the IPv4 client).

Replays: the game posts `replay`, the code of its replay link (`js/replay.js`: seed, mode, animals, handicap, the world tick play began on and every hop with its tick). With `VERIFY=0` the field is optional and only checked for shape (a string of at most 32768 URL-safe base64 characters, else 400; then a code that does not decode as a replay is stored as `null`). Either way an accepted replay is stored on the entry and returned as `replay` on every top entry of every GET (at most 10 per response, so bodies stay small; an entry without one has `replay: null`). The POST reply's `top` entries leave `replay` out. Only the top 10 of each bucket keep their replay: an entry pushed to rank 11 or lower has it cleared. A higher score from the same name replaces the entry and its replay; so a bucket's file holds at most 10 replays of up to 32 KB. With `VERIFY` on (the default) every POST must carry it, and the server plays the run again with `js/sim.js` (the game's own rules, no browser): the score must equal the higher score the replay plays to, the replay's mode must equal `mode`, and a `daily` run must be on that day's world (seed `dailySeedFor(day)` from `js/rules.js`, as the game's `dailySeed()`); classic, race and room runs may be on any seed. Anything else is 400 `{"error":"replay mismatch"}`. A replay is at most an hour of play and is cut off after `VERIFY_MS`. The run must also end within `(score + 10) x 20` seconds of play (`maxTicks = min(1 hour, (score + 10) x 120 x 20)`); a run that does not is rejected like a mismatch. Replaying is synchronous: keep `RATE_MAX` low; `VERIFY_BUDGET_MS` caps the total simulation time per minute whatever the clients, `VERIFY_CLIENT_MS` per client.

What a replay costs (measured 17 Oct 2026, Node 22, 4 cores, fresh processes): in a cold process (the JIT has not compiled the rules yet) the first replay of the 62 s bench run takes 42-49 ms and of a 92 s run 52-87 ms, about 5-8 µs per tick, so a 5-minute run checked cold would take about 170-290 ms here and pass `VERIFY_MS` on a slower machine. So the server warms up before it listens: it replays the built-in bench run (`tests/bench-replay.txt`, 62 s over every lane kind, embedded in `scores.mjs`, so no test file is needed) 10 times, which takes 140-190 ms at start. Warm, the 92 s run takes 11-15 ms (1.0-1.3 µs per tick, a spike to 3 µs under GC), so a 5-minute run about 45 ms (up to about 110 ms) and an hour about 0.5 s. A posted code that is not already clean is replayed twice (the second time to check the fresh code, below).

The stored replay: the server keeps only the hops the run applied (`simulate()` tells it each hop the rules started: not a refused move, not one replaced in the queue, not a hop for a player who never joined or after the end), encoded fresh with `encodeReplay`, and checks that this code plays to the same end (if it ever did not, it stores the posted hops of the joined players up to the end tick, which are the same run by construction). So a padded code is stored at its true size, and links and ghosts made from it play the same.

One run, one place: each entry keeps a fingerprint of its run (seed, mode, start tick, the joined animals, handicap and the applied hops; the fox and the pig count as the frog, whose run is the same: their traits pay coins only). A run already on the boards, or one that was and was dropped (replaced by a higher run of the name, pushed out of a full bucket, or on an expired day), is 409 `{"error":"this run is already on the boards"}`, under any name and on any day: a replay from a GET cannot be posted again as someone else's. A dropped run's fingerprint is kept with its day for 60 days behind the newest day.

Memorized worlds: classic, race, coin war and tag take any seed, so one person could practise one world (`#seed-42`) again and again. In those modes a bucket keeps at most one entry per seed (the highest), like one per name; daily and room worlds are shared on purpose and keep every run. A view of several buckets (a week, a day of all modes, all time) also keeps one entry per name and one per seed of those modes, each the best.

The server imports `../js/rules.js`, `../js/gen.js`, `../js/sim.js` and `../js/replay.js`, so deploy it next to the game's `js/` folder.

This proves the score fits the hops, not that a person made the hops: a bot can still play the game. It stops edited scores and made-up runs that do not play out.

Storage limits, so a flood of fake scores cannot wipe the board:

- A bucket is `mode|day` (day empty when absent). Each bucket keeps at most 200 entries (the highest); other buckets are untouched.
- One entry per name per bucket (and one per seed in classic, race, coin war and tag). A new post for an existing name (or seed) replaces it only if its score is higher; otherwise it is ignored (still 200).
- Day buckets more than 14 days older than the newest day seen are dropped when the newest day changes, so the files cannot grow forever (the day's file then keeps only the fingerprints, and goes after 60 days). Buckets without a day never expire.
- On disk: one file per day in `DAYS_DIR` (`{"format":2,"day":...,"entries":[...],"gone":[fingerprints]}`) and `DATA_FILE` for the entries without a day. A save rewrites only the days that changed (each to a temp file, then renamed), so a POST to today never rewrites the other days. Measured on a full table (6 modes x 15 days x 200 entries = 18000, 7.2 MB, the top 10 of each bucket with a 5.5 KB replay; scratch script `bench-store.mjs`): with a save on every POST (`SAVE_DELAY_MS=0`) a POST took p50 56 ms, p95 102 ms, max 167 ms before (the whole table sorted, de-duplicated and written), and takes p50 3 ms, p95 9 ms now; with the default 1 s save delay, the worst GET seen while POSTs came in every 50 ms was 163 ms before (the event loop blocked by the save) and 31 ms now (p99 22 ms before, 5 ms now).
- An old `scores.json` (one flat array of every entry) loads as is: on start it is compacted by these rules and split into the day files, and `DATA_FILE` is rewritten in the new format (the day files first, so a crash halfway leaves the old file whole and the next start splits it again).

## Wiring the game

`index.html` must allow the server origin in its Content-Security-Policy `connect-src`, and point at it:

    <meta name="hop-lanes-scores" content="https://your-server/scores">

To pass the token, add:

    <meta name="hop-lanes-token" content="your-token">

The page is public, so anyone can read the token: it stops drive-by bots, not a determined person.

What the game sends: `name` is the character name plus a 4-character tag the device picks once (for example `FROG 7K2Q`), so the one-entry-per-name rule keeps one score per device and character; `day` is the player's local date; `mode` is the mode played. The token is in the page (`<meta name="hop-lanes-token">`), so it stops casual scripts, not a determined one.
