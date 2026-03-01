# open-compute-db

A self-hosted, public key-value store for quick LLM or prototype experiments. You can
persist arbitrary JSON-ish payloads without spinning up a full database.

```
PUT https://<host>/kv/my-key     { "value": "hello" }
GET https://<host>/kv/my-key
DELETE https://<host>/kv/my-key
```

## Project layout

- `index.html` – public landing page / API cheat sheet
- `src/server.js` – Express + SQLite API server
- `data/kv.sqlite` – persistent storage (auto-created)
- `PORT` (default `3100`) and `DB_PATH` configurable via env vars

## API

### PUT /kv/:key

Upsert a value. Body must include `value`. Allowed types: string, number,
boolean, array, object (stored as JSON). Keys must match `[A-Za-z0-9._:-]` and
be ≤128 chars.

Response:
```json
{
  "key": "foo",
  "value": { "some": "json" },
  "type": "object",
  "updatedAt": "2026-03-01T05:00:00.000Z"
}
```

### GET /kv/:key

Returns the stored value or 404.

### DELETE /kv/:key

Removes the key; returns `{ key, deleted: true }`.

### GET /kv?prefix=&limit=

Lists up to `limit` keys (default 100, max 500) optionally filtered by prefix.

### GET /health

Basic status message + key count.

## Development

```bash
npm install
npm run dev    # nodemon
npm start      # production
```

The server writes to `data/kv.sqlite`. Make backups or rsync the file when
needed.

## Self-hosting

Below is the setup used on the Raspberry Pi that currently serves the public
instance. Adjust paths/commands to taste.

1. **Clone + install**
   ```bash
   git clone https://github.com/mikhael28/open-compute-db.git
   cd open-compute-db
   npm install
   ```
2. **Create systemd user service** (optional but convenient)
   ```ini
   # ~/.config/systemd/user/open-compute-db.service
   [Unit]
   Description=Open Compute DB
   After=network-online.target

   [Service]
   Type=simple
   WorkingDirectory=/home/<user>/open-compute-db
   Environment=PORT=3100
   ExecStart=/usr/bin/npm start --silent
   Restart=on-failure
   RestartSec=3
   StandardOutput=append:/home/<user>/open-compute-db/logs/open-compute-db.log
   StandardError=append:/home/<user>/open-compute-db/logs/open-compute-db.err.log

   [Install]
   WantedBy=default.target
   ```
   Then reload + start:
   ```bash
   systemctl --user daemon-reload
   systemctl --user enable --now open-compute-db.service
   ```
3. **Tailscale exposure (optional)**
   If you want to share the API across your tailnet / the public internet via
   Tailscale Serve/Funnel:
   ```bash
   tailscale serve --bg --set-path /compute http://127.0.0.1:3100
   tailscale funnel --bg --set-path /compute http://127.0.0.1:3100  # for public HTTPS
   ```
   Now requests to `https://<magicdns>/compute/kv/foo` reach your instance.

4. **Backups**
   The entire data set lives in `data/kv.sqlite`. Snapshot that file (e.g.
   nightly `cp` or `rsync`) to keep point-in-time backups.

5. **Customization**
   - Change `MAX_KEY_LENGTH`, `PORT`, or `DB_PATH` via env vars.
   - Add simple rate-limiting by dropping `express-rate-limit` into
     `src/server.js` if public abuse becomes a problem.

## Notes

- Values are stored as JSON text. Boolean/number/string types round-trip as-is.
- Each write updates `updatedAt`; listing sorts by this timestamp.
- This is intentionally unauthenticated. Expect occasional cleanups—do not treat it
  as a production database.
