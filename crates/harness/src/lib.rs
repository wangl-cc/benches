mod cli;
mod error;
mod metadata;
mod profile;
mod report;
mod runner;
mod spec;
mod time;
mod util;

pub use cli::{capture_benchmark_from_env, run_benchmark_from_env};
pub use error::{HarnessError, Result};
pub use profile::{BenchmarkProfile, CaptureArgs};
pub use runner::capture_benchmark;
pub use spec::{BenchWork, BenchmarkGroup, BenchmarkTarget, WorkloadSize};

const SCHEMA_VERSION: &str = "bench.run.v3";
