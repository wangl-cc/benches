fn main() -> std::process::ExitCode {
    harness::run_benchmark_from_env(
        "hash",
        "Run hash benchmarks and write structured raw JSON",
        bench_hash::benchmark,
    )
}
