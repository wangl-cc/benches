# Benchmarks for some common used Algorithms

## Scope

- Pseudo Random Number Generators
- Hash Functions

## Test Environment

### Software

- rustc 1.92.0 (ded5c06cf 2025-12-08)

### Platform

- Zen 5 (x86-64 Linux):
  - OS: Fedoa 43
  - Kernel: 6.18.5-200.fc43.x86_64
  - CPU: AMD Ryzen 9 9950X @ 5.76 GHz
  - Memory: Dual-channel DDR5 6000 MT/s

- M4 (aarch64 macOS):
  - OS: macOS Tahoe 26.2 (25C56)
  - Kernel: Darwin 25.2.0
  - CPU: Apple M4 @ 4.46 GHz

## Results

### Pseudo Random Number Generators

- Both Xoshiro256 variants have higher throughput than the PCG family.
- On Zen 5, Xoshiro256starstar is slightly faster than plusplus; on M4 it is the opposite.
- PCG MCG is consistently the fastest; Dxsm is about the same as or slightly faster than the base PCG.

### Hash Functions

- XXHASH3 is much faster than cryptographic hashes (SHA2/BLAKE3); at moderately larger sizes it can be 10x+ faster than the fastest crypto hash.
- On Zen 5, XXHASH3_128 is slightly faster than XXHASH3_64; on M4 it is the opposite.
- For cryptographic hashes, SHA256 is better at small sizes (16B, 256B) on both architectures.
- On Zen 5, Blake3 and SHA256 are close around 4 KiB (Blake3 slightly ahead; likely tied around 1-2 KiB), while larger sizes favor Blake3 clearly.
- On M4, SHA256 remains faster than Blake3 even at 16 MiB, though the gap narrows as size increases.
- SHA512 is consistently the slowest of the three cryptographic hashes.
