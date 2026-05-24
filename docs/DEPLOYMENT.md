# Deployment

This document describes the production setup for `https://benches.loongw.cc`.
The deployment target is a Cloudflare Worker with static assets, D1 for indexed
benchmark data, and R2 for immutable raw run JSON.

## Architecture

- `web/site` builds the React benchmark explorer.
- `web/worker` serves the static site and handles `/api/*`.
- D1 stores run indexes, derived summaries, host metadata, cases, and flags.
- R2 stores each uploaded raw `run.json`.
- Public reads use:
  - `GET /api/runs`
  - `GET /api/runs/:id`
  - `GET /api/results`
- Private uploads use:
  - `POST /api/runs`

Uploads use Cloudflare-generated Access service tokens. The Worker validates
the `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers against a Worker
secret named `CF_ACCESS_TOKENS`.

## Prerequisites

Install dependencies from the repository root:

```bash
pnpm --dir web install
```

Make sure Wrangler is authenticated:

```bash
pnpm --dir web/worker exec wrangler whoami
```

If needed, authenticate with:

```bash
pnpm --dir web/worker exec wrangler login
```

## Create Cloudflare Storage

Create the production D1 database:

```bash
pnpm --dir web/worker exec wrangler d1 create benchmark-results
```

Copy the returned database id into both `database_id` fields in
`web/worker/wrangler.jsonc`:

- top-level `d1_databases[0].database_id`
- `env.preview.d1_databases[0].database_id`

Create the R2 bucket:

```bash
pnpm --dir web/worker exec wrangler r2 bucket create benchmark-raw-runs
```

The bucket name must match `web/worker/wrangler.jsonc`.

Apply the D1 migrations:

```bash
pnpm --dir web/worker exec wrangler d1 migrations apply BENCH_DB --remote --env=""
```

## Configure Upload Tokens

Create one Cloudflare Access service token per benchmark machine. Suggested
names:

```text
bench-m3-max
bench-ryzen-9950x
bench-mac-mini-m1
```

For each token, save the generated Client ID and Client Secret immediately.
Cloudflare only shows the secret once.

Create a local JSON file outside the repository, for example:

```json
[
  {
    "clientId": "bench-m3-max.access",
    "clientSecret": "..."
  },
  {
    "clientId": "bench-ryzen-9950x.access",
    "clientSecret": "..."
  }
]
```

Store it as the production Worker secret:

```bash
pnpm --dir web/worker exec wrangler secret put CF_ACCESS_TOKENS --env=""
```

Paste the full JSON array when Wrangler prompts.

The older single-token secrets `CF_ACCESS_CLIENT_ID` and
`CF_ACCESS_CLIENT_SECRET` still work for local experiments, but production should
use `CF_ACCESS_TOKENS` so each machine can be revoked independently.

## Local Machine Upload Setup

The default publish API URL is committed in `web/bench.config.json`:

```json
{
  "apiUrl": "https://benches.loongw.cc"
}
```

On each benchmark machine, import only that machine's service token:

```bash
pnpm --dir web bench:auth import \
  --access-client-id <that-machine-client-id>
```

The command asks for the service token secret and for a local credential
passphrase. It writes:

```text
~/.config/benchmark-explorer/credentials.json
```

The file is encrypted with `PBKDF2-SHA-256` and `AES-256-GCM`, and is chmodded
to `0600`.

Check local credential status:

```bash
pnpm --dir web bench:auth status
```

Remove local credentials:

```bash
pnpm --dir web bench:auth logout
```

## Deploy The Worker

Run the full production deploy:

```bash
pnpm --dir web/worker deploy:production
```

This script builds the site, applies remote D1 migrations, and deploys the
Worker with static assets.

For a deploy validation without publishing:

```bash
pnpm --dir web/worker exec wrangler deploy --env="" --dry-run
```

Preview uploads use `env.preview`, where `DISABLE_INGEST=true`. Preview URLs can
read existing data but cannot upload new benchmark runs.

Validate preview configuration:

```bash
pnpm --dir web/worker exec wrangler versions upload --env preview --dry-run
```

## DNS

Route `benches.loongw.cc` to the Worker in Cloudflare:

1. Open Cloudflare dashboard.
2. Go to Workers & Pages.
3. Select the `benchmark-explorer` Worker.
4. Add a custom domain or route for `benches.loongw.cc`.

After DNS is active, verify:

```bash
curl https://benches.loongw.cc/api/runs
```

## Publish A Real Benchmark Run

Run and publish one scope:

```bash
pnpm --dir web bench:run -- --scope hash --profile publish
pnpm --dir web bench:publish ../target/bench-runs/hash/latest.json
```

Run and publish all scopes independently:

```bash
pnpm --dir web bench:run:publish -- --scope all --profile publish
```

Production ingest rejects quick benchmark runs. Use quick runs only for local
smoke tests.

## Operational Notes

- Revoke one machine by deleting that machine's Cloudflare Access service token
  and then updating the `CF_ACCESS_TOKENS` Worker secret without that entry.
- Do not commit service token JSON, `.dev.vars`, `.env`, or local credential
  files.
- `web/worker/.dev.vars` is ignored and is only for local Worker development.
- If the schema changes, add a D1 migration under `web/worker/migrations/` and
  run the remote migration before or during deploy.
- If `wrangler deploy` warns about environments, use `--env=""` for production.
