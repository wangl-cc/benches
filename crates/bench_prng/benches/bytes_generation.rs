use harness::{BenchmarkGroup, WorkloadSize};

const QUICK_BYTE_SIZES: &[u64] = &[16, 64, 256, 1024, 4096, 65_536];
const PUBLISH_BYTE_SIZES: &[u64] = &[16, 64, 256, 1024, 4096, 16_384, 65_536, 1 << 20];

fn main() -> std::process::ExitCode {
    harness::run_benchmark_from_env(
        "Run PRNG bytes generation benchmarks and write structured raw JSON",
        benchmark_group,
    )
}

fn benchmark_group() -> BenchmarkGroup {
    BenchmarkGroup::builder("PRNG Bytes Generation")
        .description("Fills fixed-size byte buffers from each PRNG implementation.")
        .workload_axis("Buffer size", "bytes")
        .quick_sizes(QUICK_BYTE_SIZES.iter().copied())
        .publish_sizes(PUBLISH_BYTE_SIZES.iter().copied())
        .prepare(|size: WorkloadSize| bench_prng::BytesWorkload {
            buf: vec![0; size.amount() as usize],
        })
        .case(bench_prng::cases::Pcg64)
        .case(bench_prng::cases::Pcg64Mcg)
        .case(bench_prng::cases::Pcg64Dxsm)
        .case(bench_prng::cases::Xoshiro256PlusPlus)
        .case(bench_prng::cases::Xoshiro256StarStar)
        .build()
}
