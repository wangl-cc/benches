# Rust Benchmark Workspace

This repository is used to benchmark and compare algorithms used in real
projects, with shared tooling for running, collecting, and aggregating results.

Current scopes include hashing and PRNG, but the repository is not limited to
those two categories.

## Benchmarks

Current benchmark crates:

- [bench_hash/README.md](bench_hash/README.md): non-cryptographic and
  cryptographic hash throughput.
- [bench_map/README.md](bench_map/README.md): map operation throughput across
  standard and order-preserving map implementations.
- [bench_prng/README.md](bench_prng/README.md): PRNG generation throughput.

## Workspace Layout

- `bench_*/`: benchmark crates.
- `xtask/`: benchmark orchestration CLI (`run`, `collect`, `aggregate`).
- `results/{platform}/`: collected charts and platform metadata.
- `bench_*/RESULTS.md`: cross-platform aggregated result pages.

## Quick Start

Prerequisites:

- Rust toolchain (`stable` is enough for running/collecting/aggregating).
- `cargo +nightly fmt --all` if you want to apply formatting.

Run all benchmark scopes:

```bash
cargo xr
```

Run only one scope:

```bash
cargo xr --scope hash
cargo xr --scope map
cargo xr --scope prng
```

Run quick mode:

```bash
cargo xr --quick
```

Collect local charts from existing benchmark artifacts:

```bash
cargo xc
```

Collect and run benchmarks first:

```bash
cargo xcr
```

Aggregate all platform results into crate-local `RESULTS.md`:

```bash
cargo xa
```

Note: `xtask` currently aggregates configured scopes (`hash`, `map`, `prng`). New
scopes can be added by extending the scope configuration in `xtask`.

## Result Files

For each platform:

- `results/{platform}/README.md`
- `results/{platform}/environment.ini`
- `results/{platform}/charts/*.svg`

`environment.ini` uses a minimal INI format:

```ini
[environment]
cpu = ...
os = ...
kernel = ...
rustc = ...
llvm = ...
```

## Automation

GitHub Actions workflow
[`aggregate-results.yml`](.github/workflows/aggregate-results.yml) will
re-run aggregation when `results/**` changes and auto-commit updated
`bench_*/RESULTS.md`.

## Development Commands

- `cargo check --workspace`
- `cargo clippy`
- `cargo +nightly fmt --all`
- `cargo test -p xtask`
