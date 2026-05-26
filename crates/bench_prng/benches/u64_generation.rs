use harness::{BenchmarkGroup, WorkloadSize};

const QUICK_U64_COUNTS: &[u64] = &[1, 64, 1024];
const PUBLISH_U64_COUNTS: &[u64] = &[1, 4, 16, 64, 256, 1024, 4096, 16_384];

fn main() -> std::process::ExitCode {
    harness::run_benchmark_from_env(
        "Run PRNG u64 generation benchmarks and write structured raw JSON",
        benchmark_group,
    )
}

fn benchmark_group() -> BenchmarkGroup {
    BenchmarkGroup::builder("PRNG u64 Generation")
        .description("Generates fixed-size batches of u64 values from each PRNG implementation.")
        .workload_axis("Batch length", "elements")
        .quick_sizes(QUICK_U64_COUNTS.iter().copied())
        .publish_sizes(PUBLISH_U64_COUNTS.iter().copied())
        .prepare(|size: WorkloadSize| bench_prng::U64Workload {
            count: size.amount() as usize,
        })
        .case(bench_prng::cases::Pcg64)
        .case(bench_prng::cases::Pcg64Mcg)
        .case(bench_prng::cases::Pcg64Dxsm)
        .case(bench_prng::cases::Xoshiro256PlusPlus)
        .case(bench_prng::cases::Xoshiro256StarStar)
        .build()
}
