# Cloudflare Setup And Deployment

This is the production runbook for `https://benches.loongw.cc`.

The project deploys as one Cloudflare Worker with static assets:

- `site/` builds the React explorer.
- `worker/` serves `/api/*` and static assets.
- D1 stores gzip-compressed raw `run.json` blobs plus queryable summaries.
- There is no R2 dependency.

All commands in this document assume the current directory is `web/`:

```bash
cd web
```

## Cloudflare Worker Build Settings

Create or connect the Worker from the Cloudflare dashboard:

1. Open **Workers & Pages**.
2. Create or open the `benchmark-explorer` Worker.
3. Connect this repository from **Settings > Builds**.
4. Use the settings below.

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Root directory | `web` |
| Build command | `pnpm install --frozen-lockfile` |
| Deploy command | `pnpm run deploy` |
| Non-production branch deploy command | `pnpm run deploy -- --preview` |

The Worker name must match `name` in `wrangler.jsonc`:

```jsonc
"name": "benchmark-explorer"
```

`wrangler.jsonc` lives at the `web/` root. Wrangler is also installed in the
top-level `web` package, so direct Wrangler commands use
`pnpm exec wrangler` from this directory and pass `--config wrangler.jsonc`
when the command needs the Worker project configuration.

If the Cloudflare UI exposes only one command field, use:

```bash
pnpm install --frozen-lockfile && pnpm run deploy
```

## One-Time Resource Setup

Install dependencies:

```bash
pnpm install
```

Authenticate Wrangler:

```bash
pnpm exec wrangler login
pnpm exec wrangler whoami
```

Create the D1 database:

```bash
pnpm exec wrangler d1 create benchmark-results
```

Copy the returned database id into top-level
`d1_databases[0].database_id` in `wrangler.jsonc`.

Apply the initial production schema:

```bash
pnpm run migrate -- --remote
```

## Migration Strategy

This project currently has one migration:

```text
worker/migrations/0001_initial.sql
```

The current schema is a fresh-start schema for the new raw-run model. It stores:

- gzip-compressed raw run JSON in `runs.raw_json_gzip`;
- the single benchmark name in `runs.benchmark_name`;
- case metadata in `run_cases`;
- derived summaries in `run_summaries`.

If a remote D1 database already applied an older prototype `0001_initial.sql`,
do not assume this file will be reapplied. Use one of these strategies before
deploying:

- preferred before production data exists: recreate the D1 database and update
  `wrangler.jsonc` with the new database id;
- if production data must be preserved: add a new numbered migration instead of
  editing `0001_initial.sql`.

For this repository state, old prototype data is not migrated. Regenerate and
upload benchmark runs with the current harness.

## Upload Authentication

Uploads use Cloudflare Access service tokens. Create one service token per
benchmark machine, for example:

```text
bench-m3-max
bench-ryzen-9950x
```

Cloudflare shows each Client Secret only once. Store all active machine tokens
as one JSON array:

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

Save the same JSON array as a Worker secret:

```bash
pnpm exec wrangler secret put CF_ACCESS_TOKENS --config wrangler.jsonc
```

To revoke one machine, delete that machine's Cloudflare Access service token,
remove its entry from the JSON array, and update the Worker secret.

The frontend never receives upload secrets. Only local scripts or CI secrets
can call `POST /api/runs`.

## Preview Policy

Preview deploys use:

```bash
pnpm run deploy -- --preview
```

Preview uploads a Worker version with `wrangler versions upload`; it does not
promote a deployment and does not run migrations. Preview shares the production
D1 database and can write when the request carries a valid upload token. It is
intentionally not isolated. In normal use, preview is effectively read-mostly
because the public frontend has no upload secret.

## Custom Domain

Attach the production domain after the Worker exists:

1. Open the `benchmark-explorer` Worker.
2. Add a custom domain for `benches.loongw.cc`.
3. Wait for Cloudflare to activate the route.

Verify the public API:

```bash
curl https://benches.loongw.cc/api/runs
```

## Benchmark Machine Setup

The production API URL is committed in `bench.config.json`:

```json
{
  "apiUrl": "https://benches.loongw.cc"
}
```

On each benchmark machine, import only that machine's service token:

```bash
pnpm auth import \
  --access-client-id <that-machine-client-id>
```

The command prompts for the service token secret and a local encryption
passphrase. It writes:

```text
~/.config/benchmark-explorer/credentials.json
```

The publish client does not read upload secrets from environment variables.
The normal local workflow uses this encrypted credential file.

Useful credential commands:

```bash
pnpm auth status
pnpm auth logout
```

## Publish Results

Run all benchmark targets with the publish profile, then upload each generated
run:

```bash
pnpm publish
```

To validate the publish profile without uploading:

```bash
pnpm bench
```

Production ingest rejects quick benchmark runs. Use quick runs only for local
smoke tests.

## Local Development

Run the local Worker and explorer:

```bash
pnpm dev
```

This applies local D1 migrations, starts the Worker, and starts the React
explorer. Vite proxies `/api/*` to the local Worker.

Seed local D1 with synthetic runs:

```bash
pnpm seed
```

Local Worker secrets live in `.dev.vars`, which is ignored by Git. Do not
commit service token JSON, `.dev.vars`, `.env`, or local credential files.

## Deploy And Validation Commands

Normal production deploy:

```bash
pnpm run deploy
```

Manual preview deploy:

```bash
pnpm run deploy -- --preview
```

Local checks before merging:

```bash
pnpm verify -- --all
```

Useful smaller checks:

```bash
pnpm verify
pnpm verify -- --rust
pnpm verify -- --web
pnpm verify -- --deploy
pnpm smoke
```
