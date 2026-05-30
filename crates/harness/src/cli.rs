use std::{env, error::Error, path::PathBuf, process::ExitCode};

use clap::{Args, CommandFactory, FromArgMatches, Parser, ValueEnum};

use crate::{
    HarnessError, Result,
    profile::{BenchmarkProfile, CaptureConfig, ProfileOverrides},
    runner::capture_benchmark,
    spec::BenchmarkGroup,
};

#[derive(Debug, Clone, Args)]
pub struct CaptureArgs {
    /// Measurement profile to use.
    #[arg(long, value_enum)]
    profile: Option<CliProfile>,

    /// Alias for --profile quick.
    #[arg(long, conflicts_with = "profile")]
    quick: bool,

    /// Override the number of samples collected per measurement.
    #[arg(long)]
    samples: Option<usize>,

    /// Override warmup duration per case in milliseconds.
    #[arg(long)]
    warmup_ms: Option<u64>,

    /// Override the minimum calibration duration in milliseconds.
    #[arg(long)]
    calibration_ms: Option<u64>,

    /// Override the target measurement duration per sample in milliseconds.
    #[arg(long)]
    target_sample_ms: Option<u64>,

    /// Output JSON path. Defaults to target/bench-runs/<benchmark>/latest.json.
    #[arg(long)]
    out: Option<PathBuf>,
}

impl CaptureArgs {
    fn into_config(self) -> Result<CaptureConfig> {
        let profile = if self.quick {
            BenchmarkProfile::Quick
        } else {
            self.profile.unwrap_or(CliProfile::Publish).into()
        };
        let overrides = ProfileOverrides {
            sample_count: self.samples,
            warmup_ms: self.warmup_ms,
            calibration_min_ms: self.calibration_ms,
            target_sample_ms: self.target_sample_ms,
        };
        CaptureConfig::new(profile, overrides, self.out)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
enum CliProfile {
    Quick,
    Publish,
}

impl From<CliProfile> for BenchmarkProfile {
    fn from(profile: CliProfile) -> Self {
        match profile {
            CliProfile::Quick => Self::Quick,
            CliProfile::Publish => Self::Publish,
        }
    }
}

#[derive(Debug, Parser)]
struct CaptureCli {
    #[command(flatten)]
    args: CaptureArgs,
}

pub fn capture_benchmark_from_env(
    about: &'static str,
    build_group: impl FnOnce() -> BenchmarkGroup,
) -> Result<()> {
    let args = env::args().filter(|arg| arg != "--bench");
    let mut command = CaptureCli::command();
    command = command.about(about);
    let matches = command
        .try_get_matches_from(args)
        .map_err(|error| HarnessError::new(error.to_string()))?;
    let cli = CaptureCli::from_arg_matches(&matches)
        .map_err(|error| HarnessError::new(error.to_string()))?;
    capture_benchmark(cli.args.into_config()?, build_group)
}

pub fn run_benchmark_from_env(
    about: &'static str,
    build_group: impl FnOnce() -> BenchmarkGroup,
) -> ExitCode {
    match capture_benchmark_from_env(about, build_group) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error}");
            let mut source = error.source();
            while let Some(error) = source {
                eprintln!("caused by: {error}");
                source = error.source();
            }
            ExitCode::FAILURE
        }
    }
}
