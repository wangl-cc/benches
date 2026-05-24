# PRNG Benchmarks

This crate compares throughput of non-cryptographic PRNGs for trusted-data
compute workloads.

It is not:

- a cryptographic security evaluation;
- a statistical certification suite (for example TestU01 / PractRand).

## What This Benchmark Measures

- The measured output is sustained generation throughput, not randomness quality.
- `u64_generation` reports how many `u64` values are produced per second (`Elements/s`).
- `bytes_generation` reports how many bytes are filled per second (`Bytes/s`).
- Throughput is observed across multiple batch sizes and buffer sizes.

Fixed setup:

- Deterministic seeding with `seed_from_u64(42)`.
- `black_box` to prevent dead-code elimination.
- RNG state is created once per benchmark case, then measured in steady-state.

## PRNG Included

### PCG family

- **[PCG64](https://docs.rs/rand_pcg/latest/rand_pcg/type.Pcg64.html)**:
  balanced baseline in the PCG family.
- **[PCG64-MCG](https://docs.rs/rand_pcg/latest/rand_pcg/type.Pcg64Mcg.html)**:
  multiplicative variant, often faster state transition.
- **[PCG64DXSM](https://docs.rs/rand_pcg/latest/rand_pcg/type.Pcg64Dxsm.html)**:
  DXSM output variant, commonly used for stronger quality margin.

### xoshiro family

- **[xoshiro256++](https://docs.rs/rand_xoshiro/latest/rand_xoshiro/struct.Xoshiro256PlusPlus.html)**:
  very fast general-purpose PRNG.
- **[xoshiro256\*\*](https://docs.rs/rand_xoshiro/latest/rand_xoshiro/struct.Xoshiro256StarStar.html)**:
  another high-throughput variant with a different output scrambler.

## Run

From the workspace root:

```bash
cargo bench -p bench_prng --bench prng -- --profile publish
```

Quick run:

```bash
cargo bench -p bench_prng --bench prng -- --profile quick
```

Write to a specific path:

```bash
cargo bench -p bench_prng --bench prng -- --out target/bench-runs/prng/custom.json
```

## Reading the Results

- `u64_generation` reflects per-call generator core cost.
- `bytes_generation` reflects generator cost plus memory write pressure.
- Small sizes are more sensitive to loop/dispatch overhead.
- Large sizes are more bandwidth-sensitive.

## Result Artifacts

The harness writes structured JSON to `target/bench-runs/prng/latest.json` by
default. Raw timings are in `samples`; `cases` carries input metadata,
algorithm colors, and workload descriptions. The ingest API derives summaries,
throughput, tail latency, and stability metrics from the raw samples.
