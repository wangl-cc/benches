use std::{env, error::Error, process::ExitCode};

use clap::{CommandFactory, FromArgMatches, Parser};

use crate::{
    HarnessError, Result,
    profile::{BenchmarkProfile, CaptureArgs},
    runner::capture_benchmark,
    spec::BenchmarkTarget,
};

#[derive(Debug, Parser)]
struct CaptureCli {
    #[command(flatten)]
    args: CaptureArgs,
}

pub fn capture_benchmark_from_env(
    name: &'static str,
    about: &'static str,
    build_target: impl FnOnce(BenchmarkProfile) -> BenchmarkTarget,
) -> Result<()> {
    let args = env::args().filter(|arg| arg != "--bench");
    let mut command = CaptureCli::command();
    command = command.name(name).about(about);
    let matches = command
        .try_get_matches_from(args)
        .map_err(|error| HarnessError::new(error.to_string()))?;
    let cli = CaptureCli::from_arg_matches(&matches)
        .map_err(|error| HarnessError::new(error.to_string()))?;
    capture_benchmark(cli.args, build_target)
}

pub fn run_benchmark_from_env(
    name: &'static str,
    about: &'static str,
    build_target: impl FnOnce(BenchmarkProfile) -> BenchmarkTarget,
) -> ExitCode {
    match capture_benchmark_from_env(name, about, build_target) {
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
