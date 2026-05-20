# Map Benchmarks

This crate compares common Rust map-like containers across insertion, removal,
lookup, and traversal workloads.

It is not:

- a memory-use benchmark;
- a HashDoS resistance benchmark;
- a replacement for profiling a specific application workload.

## What This Benchmark Measures

- Batch insertion into empty or preallocated containers.
- Batch removal from prebuilt containers.
- Lookup for present keys and absent keys.
- Full traversal over all entries.
- Steady-state churn that removes one resident key and inserts one replacement
  key while keeping the container size fixed.

Fixed setup:

- `u64 -> u64` keys and values for the lowest-overhead baseline.
- `[u8; 16]`, `[u8; 64]`, and `[u8; 256]` keys with `u64` values to observe
  fixed byte-key length effects.
- Deterministic unique keys and deterministic shuffled operation order.

## Maps Included

- **HashMap-rapidhash**:
  `std::collections::HashMap` with `rapidhash::fast::RandomState`.
- **HashMap-nohash**: `std::collections::HashMap` with
  `nohash_hasher::BuildNoHashHasher<u64>`, only for the `u64` workload.
- **BTreeMap**: standard ordered tree map.
- **IndexMap-rapidhash**: insertion-order hash map with
  `rapidhash::fast::RandomState` and `swap_remove` deletion for unordered fast
  removal.
- **IndexMap-nohash**: insertion-order hash map with
  `nohash_hasher::BuildNoHashHasher<u64>`, only for the `u64` workload.
- **VecPair**: unordered `Vec<(K, u64)>` with linear lookup and
  `swap_remove` deletion.

## Run

From the workspace root:

```bash
cargo bench -p bench_map
```

For repository-level collection (bench run + snapshot artifacts):

```bash
cargo run -p xtask -- collect --run-bench
```

Quick run through `xtask`:

```bash
cargo run -p xtask -- run --scope map --quick
```

## Reading the Results

- `nohash` variants are only meaningful for integer keys where the key itself
  is already a suitable hash-domain value.
- Hash-based maps use explicit hasher variants only; the benchmark does not run
  the default `RandomState` hasher for `HashMap` or `IndexMap`.
- Byte-array workloads measure key hashing and comparison cost without heap
  allocation during key cloning.
- `VecPair` gives a compact linear-scan baseline; lookup and removal are
  expected to scale linearly with entry count.
- `VecPair` runs the largest entry count for insertion and iteration, but skips
  the largest entry count for lookup, removal, and churn because those cases
  only re-measure the known linear-scan worst case at very high runtime cost.
- Iteration order differs by implementation: `BTreeMap` is sorted, `IndexMap`
  variants and `VecPair` are insertion-oriented before removals, and `HashMap`
  variants have unspecified order.

## Result Artifacts

Source-of-truth snapshots are stored under [`../results`](../results):

- `../results/{platform}/README.md`
- `../results/{platform}/charts/map_insert_batch_lines_throughput.svg`
- `../results/{platform}/charts/map_remove_batch_lines_throughput.svg`
- `../results/{platform}/charts/map_lookup_hit_lines_throughput.svg`
- `../results/{platform}/charts/map_lookup_missing_lines_throughput.svg`
- `../results/{platform}/charts/map_iter_lines_throughput.svg`
- `../results/{platform}/charts/map_churn_lines_throughput.svg`

Crate-local cross-platform index:

- `RESULTS.md` (generated from root results)
