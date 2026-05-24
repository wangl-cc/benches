# Rust Benchmark Workspace

This repository benchmarks algorithms used in real projects and publishes raw
measurements to a Cloudflare-backed explorer.

## Workspace Layout

- `crates/harness/`: shared Rust measurement library.
- `crates/bench_hash/`: hash benchmark scope and `hash` bench target.
- `crates/bench_prng/`: PRNG benchmark scope and `prng` bench target.
- `web/site/`: React/Vite benchmark explorer.
- `web/worker/`: Cloudflare Worker API, static assets config, D1 migrations,
  and R2/D1 bindings.
- `web/packages/bench-schema/`: shared TypeScript validation helpers.
- `web/scripts/`: benchmark orchestration, publish client, and seed data tools.

## Running Benchmarks

From the repository root, run through the web orchestration workspace:

```bash
pnpm --dir web bench:run -- --scope all --profile publish
pnpm --dir web bench:run -- --scope hash --profile quick
pnpm --dir web bench:run -- --scope prng --profile quick
```

The TS wrapper calls the standard Cargo bench targets:

```bash
cargo bench -p bench_hash --bench hash -- --profile publish
cargo bench -p bench_prng --bench prng -- --profile publish
```

Default outputs are scope-specific:

```text
target/bench-runs/hash/latest.json
target/bench-runs/prng/latest.json
```

Use `--out` only with a single scope:

```bash
pnpm --dir web bench:run -- --scope hash --out ../target/bench-runs/hash/custom.json
```

The publish profile collects 100 samples per case after warmup/calibration.
Quick mode is only for smoke tests and is rejected by production ingest.

## Publishing And Local Web

Publish one run:

```bash
pnpm --dir web bench:auth import \
  --access-client-id <cloudflare-access-client-id>
pnpm --dir web bench:publish ../target/bench-runs/hash/latest.json
```

The default API URL comes from `web/bench.config.json` and points to
`https://benches.loongw.cc`. `bench:auth import` stores the Cloudflare Access
client id and encrypted client secret in
`~/.config/benchmark-explorer/credentials.json`. The file is encrypted with a
local passphrase and chmodded to `0600`, so the normal local workflow does not
require shell environment variables or a platform keyring. Use
`pnpm --dir web bench:auth status` to inspect the local credential metadata and
`pnpm --dir web bench:auth logout` to clear it.

Run and publish all scopes as independent runs:

```bash
pnpm --dir web bench:run:publish -- --scope all --profile publish
```

Run the Worker and explorer locally:

```bash
pnpm --dir web install
pnpm --dir web dev:8788
```

The explorer reads same-origin `/api/*` routes and falls back to fixture data
when the API is unavailable.

## Cloudflare API

The publish client validates `run.json`, computes a canonical SHA-256 hash, and
sends the run to `POST /api/runs` with Cloudflare Access service-token headers.
The Worker owns all D1/R2 writes and derives queryable summaries from raw
samples during ingest.

Deployment instructions are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

Worker endpoints:

- `POST /api/runs`: private ingest endpoint protected by Access service-token
  headers.
- `GET /api/runs`: public run index.
- `GET /api/runs/:id`: public raw run JSON.
- `GET /api/results`: public query endpoint used by the explorer.

Deploy from `web/worker`:

```bash
pnpm --dir web/worker deploy:production
```

Cloudflare Workers Builds should use:

- Root directory: `web/worker`
- Production command:
  `pnpm --dir .. install --frozen-lockfile && pnpm deploy:production`
- Preview command:
  `pnpm --dir .. install --frozen-lockfile && pnpm preview`

Preview uploads use the Worker `preview` environment, where benchmark ingest is
disabled so preview URLs cannot mutate production benchmark storage.

## Development Commands

- `cargo check --workspace`
- `cargo clippy`
- `cargo +nightly fmt --all`
- `cargo test -p harness`
- `cargo bench -p bench_hash --bench hash -- --profile quick`
- `cargo bench -p bench_prng --bench prng -- --profile quick`
- `pnpm --dir web typecheck:api`
- `pnpm --dir web test:api`
- `pnpm --dir web build`
- `pnpm --dir web bench:seed`
