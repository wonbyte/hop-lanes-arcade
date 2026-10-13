# Hop Lanes score server (optional)

Dependency-free Node 20 server for an online top-10 list.

    node server/scores.mjs

| Env | Default | Meaning |
|-----|---------|---------|
| `PORT` | `8787` | listen port |
| `DATA_FILE` | `server/scores.json` | JSON store (max 1000 entries) |
| `ALLOW_ORIGIN` | `*` | CORS `Access-Control-Allow-Origin`; set it to the game origin in production |
| `POST_TOKEN` | empty | when set, POSTs must send it in the `X-Hop-Token` header |

## Endpoints

    curl http://localhost:8787/scores
    # {"top":[{"name":"Ann","score":120,"at":"2026-01-01T00:00:00.000Z","day":null,"mode":"classic"}]}

    curl -X POST http://localhost:8787/scores \
      -H 'Content-Type: application/json' -d '{"name":"Ann","score":120}'

Per-day boards: POST may also carry `day` (string `YYYY-MM-DD`) and `mode` (`classic`, `race`, `daily` or `room`). Both are optional and stored on the entry; missing means `day: null`, `mode: "classic"`. Top entries in every response include `day` and `mode`. `GET /scores?day=YYYY-MM-DD` returns the top 10 of that day (any mode); add `&mode=daily` to filter by both. With no query it is the all-time top 10 of all entries. A malformed `day` or unknown `mode`, in a POST body or in the query, returns 400.

    curl 'http://localhost:8787/scores?day=2026-01-01&mode=daily'
    # {"top":[{"name":"Ann","score":120,"at":"2026-01-01T00:00:00.000Z","day":"2026-01-01","mode":"daily"}]}

POST rules: name 1-16 chars (letters, digits, spaces), score integer 0..100000, body at most 1 KB, 10 POSTs/min per IP (429 after that). If `POST_TOKEN` is set, POST must carry the header `X-Hop-Token` with that value, else 401 `{"error":"bad token"}` (checked before the rate limit, so junk posts do not use up the budget); GET is unaffected. Bad input returns 400, other paths 404.

## Wiring the game

`index.html` must allow the server origin in its Content-Security-Policy `connect-src`, and point at it:

    <meta name="hop-lanes-scores" content="https://your-server/scores">

To pass the token, add:

    <meta name="hop-lanes-token" content="your-token">

The page is public, so anyone can read the token: it stops drive-by bots, not a determined person.
