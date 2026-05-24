# Hash Benchmarks

This crate compares hash throughput for practical workloads such as cache keys,
in-process indexing, and trusted-data compute paths.

It is not:

- a cryptographic security evaluation;
- a HashDoS resistance benchmark.

## What This Benchmark Measures

- Throughput across input sizes from 16 B to 1 MiB in publish mode.
- Scaling behavior as buffers grow.
- Performance by output width (64 / 128 / 256 / 512 bit), which is often the
  first selection axis when collision budget matters.

Typical width-oriented use:

- 64-bit: hot-path maps, short-lived caches.
- 128-bit: larger key spaces, longer-lived cache/index keys.
- 256-bit: fingerprint-like digests.
- 512-bit: conservative workflows that need more collision margin.

## Target Platforms

Primary targets are modern `x86_64` and `aarch64` CPUs.

Assumptions:

- SIMD (x86: SSE / SSE2 / AVX2 / AVX-512; ARM: NEON / SVE),
- AES hardware acceleration (x86: AES-NI; ARM: ARMv8 Crypto Extensions – AES),
- SHA hardware acceleration (x86: SHA Extensions; ARM: ARMv8 Crypto Extensions – SHA1/SHA2).

## Hashes Included

### Non-cryptographic

These are optimized for speed and are typically used for hash tables, cache
keys, and internal indexing on trusted inputs.

- **[XOR baselines](src/lib.rs)**:
  `XOR-64-ILP` plus the platform-selected `XOR-128-SIMD` implementation.
  synthetic upper-bound throughput references (not production hashes).
- **[XXH3 / xxHash](https://github.com/Cyan4973/xxHash)** (`XXH3-64`,
  `XXH3-128`): widely used, fast, and practical general-purpose hashes.
- **[Rapidhash](https://github.com/Nicoshev/rapidhash)** (`RAPIDHASH-64`):
  very high-throughput 64-bit hash.
- **[GxHash](https://github.com/ogxd/gxhash)** (`GXHASH-64`, `GXHASH-128`):
  AES-accelerated design for modern CPUs.

### Cryptographic

These are slower than most non-cryptographic hashes, but designed for stronger
adversarial robustness and digest use cases.

- **[SHA-2](https://doi.org/10.6028/NIST.FIPS.180-4)** (`SHA2-256`,
  `SHA2-512`): standard and conservative cryptographic baseline.
- **[BLAKE2](https://www.blake2.net/)** (`BLAKE2B-512`):
  modern cryptographic hash with good software performance.
- **[BLAKE3](https://github.com/BLAKE3-team/BLAKE3)** (`BLAKE3-256`):
  very fast cryptographic hash with parallel-friendly design.

## SMHasher / SMHasher3 Notes

These quality-test results are included as reference context, not as throughput
results.

| Benchmark label | SMHasher | SMHasher3 |
| --- | --- | --- |
| `XOR-64-ILP` | N/A | N/A |
| `XOR-128-SIMD` | N/A | N/A |
| `RAPIDHASH-64` | Pass | Pass |
| `XXH3-64` | Fail* | Fail† |
| `XXH3-128` | Pass | Fail† |
| `GXHASH-64` | Pass | Fail† |
| `GXHASH-128` | N/A | Fail† |
| `SHA2-256` | Pass | Pass |
| `SHA2-512` | N/A | N/A |
| `BLAKE3-256` | Pass | Pass |
| `BLAKE2B-512` | N/A | N/A |

Fail reasons:

- \*: `XXH3-64` in SMHasher reports issues such as
  `DiffDist bit 7 w. 36 bits` and `BIC`.
- †: In SMHasher3, these hashes pass sanity checks but fail stricter
  statistical tests.

## Run

From the workspace root:

```bash
cargo bench -p bench_hash --bench hash -- --profile publish
```

Quick run:

```bash
cargo bench -p bench_hash --bench hash -- --profile quick
```

Write to a specific path:

```bash
cargo bench -p bench_hash --bench hash -- --out target/bench-runs/hash/custom.json
```

## Reading the Results

- For very large inputs (MiB scale+), many fast non-cryptographic hashes
  approach memory-bandwidth limits, so curves may converge.
- For very small inputs, call overhead and short-input pipeline effects
  dominate, so ordering can differ from large-buffer workloads.
- Cryptographic hashes are usually more compute-bound, so their curves are
  often flatter across sizes.

## Result Artifacts

The harness writes structured JSON to `target/bench-runs/hash/latest.json` by
default. Raw timings are in `samples`; `cases` carries input metadata,
algorithm colors, and workload descriptions. The ingest API derives summaries,
throughput, tail latency, and stability metrics from the raw samples.
