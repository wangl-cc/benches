fn main() -> std::process::ExitCode {
    harness::run_benchmark_from_env(
        "prng",
        "Run PRNG benchmarks and write structured raw JSON",
        bench_prng::benchmark,
    )
}
