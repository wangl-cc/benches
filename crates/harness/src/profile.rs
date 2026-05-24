use std::{path::PathBuf, time::Duration};

use clap::{Args, ValueEnum};

use crate::{HarnessError, Result};

const CASE_ORDER_SEED: u64 = 0x2f31_4d45_4153_5552;

#[derive(Debug, Clone, Args)]
pub struct CaptureArgs {
    /// Measurement profile to use.
    #[arg(long, value_enum, default_value_t = BenchmarkProfile::Publish)]
    pub profile: BenchmarkProfile,

    /// Alias for --profile quick.
    #[arg(long)]
    pub quick: bool,

    /// Override the number of samples collected per measurement.
    #[arg(long)]
    pub samples: Option<usize>,

    /// Override warmup duration per case in milliseconds.
    #[arg(long)]
    pub warmup_ms: Option<u64>,

    /// Override the minimum calibration duration in milliseconds.
    #[arg(long)]
    pub calibration_ms: Option<u64>,

    /// Override the target measurement duration per sample in milliseconds.
    #[arg(long)]
    pub target_sample_ms: Option<u64>,

    /// Output JSON path. Defaults to target/bench-runs/<benchmark>/latest.json.
    #[arg(long)]
    pub out: Option<PathBuf>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum BenchmarkProfile {
    Quick,
    Publish,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct RunProfile {
    pub(crate) profile: BenchmarkProfile,
    pub(crate) sample_count: usize,
    pub(crate) warmup: Duration,
    pub(crate) calibration_min: Duration,
    pub(crate) target_sample: Duration,
    pub(crate) case_order_seed: u64,
}

impl RunProfile {
    pub(crate) fn new(profile: BenchmarkProfile) -> Self {
        match profile {
            BenchmarkProfile::Quick => Self {
                profile,
                sample_count: 10,
                warmup: Duration::from_millis(5),
                calibration_min: Duration::from_millis(5),
                target_sample: Duration::from_millis(5),
                case_order_seed: CASE_ORDER_SEED,
            },
            BenchmarkProfile::Publish => Self {
                profile,
                sample_count: 100,
                warmup: Duration::from_millis(500),
                calibration_min: Duration::from_millis(100),
                target_sample: Duration::from_millis(25),
                case_order_seed: CASE_ORDER_SEED,
            },
        }
    }

    pub(crate) fn from_args(args: &CaptureArgs) -> Result<Self> {
        let selected = if args.quick {
            BenchmarkProfile::Quick
        } else {
            args.profile
        };
        let mut profile = Self::new(selected);
        if let Some(sample_count) = args.samples {
            if sample_count < 3 {
                return Err(HarnessError::new("--samples must be at least 3"));
            }
            profile.sample_count = sample_count;
        }
        if let Some(ms) = args.warmup_ms {
            profile.warmup = duration_from_millis_arg("--warmup-ms", ms)?;
        }
        if let Some(ms) = args.calibration_ms {
            profile.calibration_min = duration_from_millis_arg("--calibration-ms", ms)?;
        }
        if let Some(ms) = args.target_sample_ms {
            profile.target_sample = duration_from_millis_arg("--target-sample-ms", ms)?;
        }
        Ok(profile)
    }
}

fn duration_from_millis_arg(name: &str, ms: u64) -> Result<Duration> {
    if ms == 0 {
        return Err(HarnessError::new(format!("{name} must be greater than 0")));
    }
    Ok(Duration::from_millis(ms))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn run_profile_allows_explicit_measurement_overrides() {
        let args = CaptureArgs {
            profile: BenchmarkProfile::Publish,
            quick: false,
            samples: Some(25),
            warmup_ms: Some(11),
            calibration_ms: Some(12),
            target_sample_ms: Some(13),
            out: None,
        };
        let profile = RunProfile::from_args(&args).expect("profile");
        assert_eq!(profile.sample_count, 25);
        assert_eq!(profile.warmup, Duration::from_millis(11));
        assert_eq!(profile.calibration_min, Duration::from_millis(12));
        assert_eq!(profile.target_sample, Duration::from_millis(13));
    }
}
