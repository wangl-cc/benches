# Hash Benchmarks

`bench_hash` contains hash implementations, hash-specific helpers, and two
benchmark groups:

- `non_cryptographic_hash`
- `cryptographic_hash`

Each group is a separate Cargo bench target and produces its own `run.json`.
There is no cross-target runner inside this crate.

## Scope

This crate compares hash throughput for practical workloads such as cache keys,
in-process indexing, trusted-data compute paths, and digest generation.

It is not:

- a cryptographic security evaluation;
- a HashDoS resistance benchmark;
- a full statistical quality test suite.

## Benchmark Groups

### Non-cryptographic hash

Script entry from the repository root:

```bash
pnpm --dir web bench -- --target hash
```

Direct Cargo target:

```bash
cargo bench -p bench_hash --bench non_cryptographic_hash -- --profile publish
```

Default output:

```text
target/bench-runs/non-cryptographic-hash/latest.json
```

Cases include XOR baselines, XXH3, Rapidhash, and GxHash. These are intended
for trusted inputs, hash tables, cache keys, and internal indexing.

### Cryptographic hash

Script entry from the repository root:

```bash
pnpm --dir web bench -- --target hash
```

Direct Cargo target:

```bash
cargo bench -p bench_hash --bench cryptographic_hash -- --profile publish
```

Default output:

```text
target/bench-runs/cryptographic-hash/latest.json
```

Cases include SHA-2, BLAKE2, and BLAKE3. These are stronger digest-oriented
algorithms and are expected to trade throughput for robustness.

## Workload Axis

Both groups use workload size as bytes. The group prepares the input buffer
once for each measured point, then every case receives the same prepared input
for that sample window.

The publish profile covers small through large buffers so the explorer can show
scaling behavior:

```text
16 B, 64 B, 256 B, 1 KiB, 4 KiB, 16 KiB, 64 KiB, 1 MiB
```

Quick profile uses fewer sizes and fewer samples. It is only for smoke tests.

## Case Shape

Cases live in `src/lib.rs`; bench files only assemble groups. A case implements
`harness::BenchmarkCase<Vec<u8>>`:

```rust
impl harness::BenchmarkCase<Vec<u8>> for Sha256 {
    type State = Vec<u8>;
    type Output = digest::Output<sha2::Sha256>;

    fn name(&self) -> &'static str {
        "SHA2-256"
    }

    fn color(&self) -> &'static str {
        "#ea580c"
    }

    fn prepare(&self, input: Vec<u8>) -> Self::State {
        input
    }

    fn run_once(&self, input: &mut Self::State) -> Self::Output {
        hash::<sha2::Sha256>(input.as_slice())
    }
}
```

The harness consumes the output with `black_box`; benchmark code does not need
to manually add a black box inside `run_once`.

## Hashes Included

### Non-cryptographic

- `XOR-64-ILP` and `XOR-128-SIMD`: synthetic upper-bound references, not
  production hashes.
- `XXH3-64` and `XXH3-128`: fast general-purpose hashes.
- `RAPIDHASH-V3`: high-throughput 64-bit hash.
- `GXHASH-64` and `GXHASH-128`: AES-accelerated hashes.

### Cryptographic

- `SHA2-256` and `SHA2-512`: conservative standard baselines.
- `BLAKE2B-512`: modern cryptographic hash with good software performance.
- `BLAKE3-256`: fast cryptographic hash with a parallel-friendly design.

## Reading Results

- Small inputs emphasize call overhead and short-input pipeline effects.
- Large inputs can approach memory bandwidth limits, especially for fast
  non-cryptographic hashes.
- Cryptographic hashes are usually more compute-bound, so their curves often
  scale differently from non-cryptographic hashes.

Raw timings are in `measurements[].samples`. The Worker derives throughput,
tail sample-window latency, and stability metrics during ingest.
