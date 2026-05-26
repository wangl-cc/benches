# Rust Benchmark Explorer

This repository benchmarks Rust algorithm implementations and publishes raw
measurements to a Cloudflare-hosted benchmark explorer at
`https://benches.loongw.cc`.

The workspace has two boundaries:

- `crates/`: Rust benchmark implementations and the shared measurement library.
- `web/`: PNPM, React/Vite, Cloudflare Worker, D1 schema, publish scripts, and
  deployment documentation.

## Repository Layout

```text
crates/
  harness/          Shared measurement library. It is not a bench target.
  bench_hash/       Hash benchmark groups and hash implementations.
  bench_prng/       PRNG benchmark groups and PRNG implementations.

web/
  site/             React/Vite explorer UI.
  worker/           Cloudflare Worker API and D1 migrations.
  packages/
    bench-schema/   Shared TypeScript run.json validation.
  scripts/          Run, publish, auth, and seed scripts.
  DEPLOYMENT.md     Cloudflare setup and deployment runbook.
  wrangler.jsonc    Worker, static assets, and D1 configuration.
```

## Benchmark Model

Each Cargo bench target produces one independent run:

- one `BenchmarkGroup`;
- many workload sizes;
- many cases within that group.

The group owns the workload axis, profile-specific workload sizes, shared
workload preparation, human-readable benchmark name, and description. A case
owns only its algorithm-specific state, color, and measured operation.

The harness owns timing, warmup, calibration, sample collection, and
`black_box`. It writes raw sample windows only; the Worker derives throughput,
tail latency summaries, and stability metrics during ingest.

Current bench targets:

| Target set | Cargo package | Bench target | Default output |
| --- | --- | --- | --- |
| `hash` | `bench_hash` | `non_cryptographic_hash` | `target/bench-runs/non-cryptographic-hash/latest.json` |
| `hash` | `bench_hash` | `cryptographic_hash` | `target/bench-runs/cryptographic-hash/latest.json` |
| `prng` | `bench_prng` | `u64_generation` | `target/bench-runs/prng-u64-generation/latest.json` |
| `prng` | `bench_prng` | `bytes_generation` | `target/bench-runs/prng-bytes-generation/latest.json` |

## Run Benchmarks

From the repository root:

```bash
pnpm --dir web smoke    # quick local run and upload to local Worker
pnpm --dir web bench    # publish-profile run, no upload
pnpm --dir web publish  # publish-profile run and upload
```

For narrower runs:

```bash
pnpm --dir web smoke -- --target hash
pnpm --dir web smoke -- --target prng
pnpm --dir web bench -- --target hash
```

The script runs standard Cargo bench targets from the repository root, so users
do not need to run Cargo directly for normal workflows.

Useful harness options:

```bash
--profile quick          # smoke-test profile
--profile publish        # default, 100 samples per measurement
--samples 150            # override sample count
--warmup-ms 1000         # override warmup duration
--calibration-ms 300     # override calibration minimum
--target-sample-ms 50    # override target sample window
--out <path>             # only use with one selected bench target
```

Production ingest rejects `quick` runs. Use quick only for local validation.

## Publish Results

The production API URL lives in `web/bench.config.json` and points to
`https://benches.loongw.cc`.

On each benchmark machine, import that machine's Cloudflare Access service
token once:

```bash
pnpm --dir web auth import \
  --access-client-id <machine-access-client-id>
```

The command prompts for the client secret and stores it encrypted in:

```text
~/.config/benchmark-explorer/credentials.json
```

Run and publish all targets independently:

```bash
pnpm --dir web publish
```

## Local Web Development

Install dependencies and run the local Worker plus Vite UI:

```bash
pnpm --dir web install
pnpm --dir web dev
```

`pnpm --dir web dev` applies local D1 migrations, starts the Worker, and starts
the React explorer. Vite proxies `/api/*` to the local Worker. If the API has no
data, the UI can still render fixture data for development.

Seed local D1 with synthetic runs:

```bash
pnpm --dir web seed
```

## Cloudflare Deployment

Deployment setup is documented in [web/DEPLOYMENT.md](web/DEPLOYMENT.md).

For Cloudflare Workers Builds, configure:

| Setting | Value |
| --- | --- |
| Root directory | `web` |
| Build command | `pnpm install --frozen-lockfile` |
| Deploy command | `pnpm run deploy` |
| Non-production branch deploy command | `pnpm run deploy -- --preview` |

Production deploys build the site, apply pending remote D1 migrations, and
deploy the Worker. Preview deploys use the `preview` Wrangler environment and
the same D1 database as production. Preview is intentionally not data-isolated.

## Validation Commands

The normal merge gate is one command:

```bash
pnpm --dir web verify -- --all
```

Useful smaller checks:

```bash
pnpm --dir web verify          # Rust check/test/clippy + API tests + site build
pnpm --dir web verify -- --rust
pnpm --dir web verify -- --web
pnpm --dir web verify -- --deploy
pnpm --dir web smoke           # quick local run and upload
```

## Notes For Adding Benchmarks

Add benchmark-specific helpers and implementations to the crate library, then
add one bench file per top-level benchmark group under `benches/`.

Each bench file should call:

```rust
harness::run_benchmark_from_env("Short description.", || {
    BenchmarkGroup::builder("Group Name")
        .description("What this benchmark measures.")
        .workload_axis("Input size", "bytes")
        .quick_sizes([16, 4096])
        .publish_sizes([16, 64, 256, 1024, 4096, 16384, 65536, 1048576])
        .prepare(|size| /* shared workload */)
        .case(MyCase)
        .build()
})
```

Case colors are declared in benchmark code. Keep related algorithm families in
nearby color ranges so the explorer stays visually stable across platforms.
