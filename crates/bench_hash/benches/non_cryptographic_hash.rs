use harness::{BenchmarkGroup, WorkloadSize};

const QUICK_BYTE_SIZES: &[u64] = &[16, 64, 256, 1024, 4096, 65_536];
const PUBLISH_BYTE_SIZES: &[u64] = &[16, 64, 256, 1024, 4096, 16_384, 65_536, 1 << 20];

fn main() -> std::process::ExitCode {
    harness::run_benchmark_from_env(
        "Run non-cryptographic hash benchmarks and write structured raw JSON",
        benchmark_group,
    )
}

fn benchmark_group() -> BenchmarkGroup {
    BenchmarkGroup::builder("Non-cryptographic Hash")
        .description("Hashes deterministic byte buffers with non-cryptographic hash functions.")
        .workload_axis("Message size", "bytes")
        .quick_sizes(QUICK_BYTE_SIZES.iter().copied())
        .publish_sizes(PUBLISH_BYTE_SIZES.iter().copied())
        .prepare(|size: WorkloadSize| {
            let amount = size.amount() as usize;
            bench_hash::deterministic_bytes(amount, bench_hash::INPUT_SEED ^ size.amount())
        })
        .case(bench_hash::cases::Xor64)
        .case(bench_hash::cases::Xor128)
        .case(bench_hash::cases::RapidHashV3)
        .case(bench_hash::cases::Xxh364)
        .case(bench_hash::cases::Xxh3128)
        .case(bench_hash::cases::GxHash64)
        .case(bench_hash::cases::GxHash128)
        .build()
}
