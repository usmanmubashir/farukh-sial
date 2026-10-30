# Cloudflare sync server (Worker + D1)

The app works offline and syncs through a small server. This server runs on Cloudflare: a Worker (the API) and a D1
database. One deployment serves one pharmacy. The app itself stays on GitHub Pages.

Code: `worker/src/index.js` (the server), `worker/schema.sql` (the database), `worker/scripts/seed-owner.mjs` (the first
sign-in), `js/core/sync-cloudflare.js` (the app side), `js/core/sync.js` (the engine, shared with Supabase).

## What works

- **Offline:** every sale, purchase, return, voucher and medicine saves on the device and waits in the outbox.
- **Online:** the queue is sent when the connection comes back, and other devices' changes are pulled in.
- **Staff:** staff accounts sync too. A staff member can sign in on any device after one sync. The server only ever
  stores the password hash (PBKDF2), never the password.
- **New device:** Setup → "Join an existing pharmacy" downloads the pharmacy's data. The owner's password works there.
- **First device:** Settings → Sync → "Cloudflare" uploads everything already on the device.

## Deploy (once)

You need a Cloudflare account (free) and Node.js. Run these in the `worker` folder of the repository.

1. Log in:
   ```bash
   npx wrangler login
   ```
2. Create the database:
   ```bash
   npx wrangler d1 create shifa-sync
   ```
   Copy the `database_id` it prints into `worker/wrangler.toml` (replace `REPLACE_WITH_D1_DATABASE_ID`).
3. Create the tables:
   ```bash
   npx wrangler d1 execute shifa-sync --remote --file=schema.sql
   ```
4. Set the token secret (a long random value; it signs the access tokens):
   ```bash
   npx wrangler secret put TOKEN_SECRET
   ```
   To make a random value, run `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
5. Create the first owner account on your own computer:
   ```bash
   node worker/scripts/seed-owner.mjs
   npx wrangler d1 execute shifa-sync --remote --file=worker/seed-owner.sql
   ```
   Delete `worker/seed-owner.sql` afterwards.
6. Deploy:
   ```bash
   npx wrangler deploy
   ```
   The address looks like `https://shifa-sync.<your-subdomain>.workers.dev`.

`ALLOWED_ORIGIN` in `wrangler.toml` must be the app's address (for GitHub Pages, `https://<user>.github.io`, with no
path). Only that origin may call the server from a browser.

## Connect the app

- **First device** (the one that has the data): Settings → Sync → Sync service "Cloudflare", the Worker address, the
  owner username and password → Connect. Everything on the device is uploaded.
- **Another device:** Setup → "Join an existing pharmacy" → pharmacy name, the Worker address, a username and password
  from this pharmacy → "Join and download data". Then sign in.

## Checking it

- `node worker/test/worker.test.mjs`: the server's rules (sign-in, tokens, ops, staff projection, refresh tokens).
- `node worker/test/adapter.test.mjs`: the app's adapter against the server, over HTTP.
- `node worker/test/combined-dev.mjs 8787 owner <password>`: runs the app and an in-memory server together on
  `http://localhost:8787`, so the whole flow can be tried without deploying. The data is lost when it stops.

## Limits and notes

- **Free plan:** the Worker and D1 free limits are enough for one pharmacy. Check the current numbers on the Cloudflare
  pricing page, since they change.
- **The first sync of a large pharmacy** replays the whole operation log. A snapshot would make it faster; the server
  does not keep snapshots yet.
- **Sign-in on the server** compares the password hash the device derives. The server does not run PBKDF2 itself,
  which keeps it inside the free CPU limit.
- **Sign-out** on a device does not revoke its sign-in on the server. To cut a device off, remove its staff account
  (the change syncs) or rotate `TOKEN_SECRET` (this signs every device out).
- **Document numbers and stock** follow the rules in `docs/SYNC.md`: set a device prefix on each device, and expect
  a negative stock figure if two devices sell the last units while offline.
