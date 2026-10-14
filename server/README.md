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
| `RATE_MAX` | `10` | POSTs per minute per client (override is meant for tests) |
| `TRUST_PROXY` | unset | set to `1` behind a reverse proxy or TLS terminator: the rate limit then keys on the last `X-Forwarded-For` hop instead of the socket address (without it, every player behind the proxy shares one budget) |
| `SAVE_DELAY_MS` | `1000` | accepted POSTs are written to disk at most this often, and on exit (`0` writes at once) |

## Endpoints

    curl http://localhost:8787/scores
    # {"top":[{"name":"Ann","score":120,"at":"2026-01-01T00:00:00.000Z","day":null,"mode":"classic"}]}

    curl -X POST http://localhost:8787/scores \
      -H 'Content-Type: application/json' -d '{"name":"Ann","score":120}'

Per-day boards: POST may also carry `day` (string `YYYY-MM-DD`) and `mode` (`classic`, `race`, `daily` or `room`). Both are optional and stored on the entry; missing means `day: null`, `mode: "classic"`. Top entries in every response include `day` and `mode`. `GET /scores?day=YYYY-MM-DD` returns the top 10 of that day (any mode); add `&mode=daily` to filter by both. With no query it is the all-time top 10 of all entries. A malformed `day` or unknown `mode`, in a POST body or in the query, returns 400.

    curl 'http://localhost:8787/scores?day=2026-01-01&mode=daily'
    # {"top":[{"name":"Ann","score":120,"at":"2026-01-01T00:00:00.000Z","day":"2026-01-01","mode":"daily"}]}

POST rules: name 1-16 chars (letters, digits, spaces), score integer 0..5000 (`MAX_SCORE`; 5001 gets 400), `day` no later than tomorrow (UTC), body at most 1 KB, 10 POSTs/min per IP (429 after that). IPv6 clients are limited per /64. If `POST_TOKEN` is set, POST must carry the header `X-Hop-Token` with that value (compared in constant time), else 401 `{"error":"bad token"}` (checked before the rate limit, so junk posts do not use up the budget); GET is unaffected. Bad input returns 400, other paths 404.

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
