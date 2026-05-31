mod cli;
mod error;
mod metadata;
mod profile;
mod report;
mod runner;
mod spec;
mod time;
mod util;

pub use cli::{CaptureArgs, capture_benchmark_from_env, run_benchmark_from_env};
pub use error::{HarnessError, Result};
pub use profile::{BenchmarkProfile, CaptureConfig};
pub use spec::{BenchmarkCase, BenchmarkGroup, WorkloadSize};

const SCHEMA_VERSION: &str = "bench.run.v3";
