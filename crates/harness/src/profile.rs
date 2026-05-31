use std::{path::PathBuf, time::Duration};

use crate::{HarnessError, Result};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BenchmarkProfile {
    Quick,
    Publish,
}

#[derive(Debug, Clone)]
pub struct CaptureConfig {
    pub(crate) profile: RunProfile,
    pub(crate) out: Option<PathBuf>,
}

impl CaptureConfig {
    pub(crate) fn new(
        profile: BenchmarkProfile,
        overrides: ProfileOverrides,
        out: Option<PathBuf>,
    ) -> Result<Self> {
        Ok(Self {
            profile: RunProfile::with_overrides(profile, overrides)?,
            out,
        })
    }
}

#[derive(Debug, Clone, Copy, Default)]
pub(crate) struct ProfileOverrides {
    pub(crate) sample_count: Option<usize>,
    pub(crate) warmup_ms: Option<u64>,
    pub(crate) calibration_min_ms: Option<u64>,
    pub(crate) target_sample_ms: Option<u64>,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct RunProfile {
    pub(crate) profile: BenchmarkProfile,
    pub(crate) sample_count: usize,
    pub(crate) warmup: Duration,
    pub(crate) calibration_min: Duration,
    pub(crate) target_sample: Duration,
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
            },
            BenchmarkProfile::Publish => Self {
                profile,
                sample_count: 100,
                warmup: Duration::from_millis(500),
                calibration_min: Duration::from_millis(100),
                target_sample: Duration::from_millis(25),
            },
        }
    }

    pub(crate) fn with_overrides(
        benchmark_profile: BenchmarkProfile,
        overrides: ProfileOverrides,
    ) -> Result<Self> {
        let mut profile = Self::new(benchmark_profile);
        if let Some(sample_count) = overrides.sample_count {
            if sample_count < 3 {
                return Err(HarnessError::new("sample count must be at least 3"));
            }
            profile.sample_count = sample_count;
        }
        if let Some(ms) = overrides.warmup_ms {
            profile.warmup = duration_from_millis("warmup duration", ms)?;
        }
        if let Some(ms) = overrides.calibration_min_ms {
            profile.calibration_min = duration_from_millis("minimum calibration duration", ms)?;
        }
        if let Some(ms) = overrides.target_sample_ms {
            profile.target_sample = duration_from_millis("target sample duration", ms)?;
        }
        Ok(profile)
    }
}

fn duration_from_millis(name: &str, ms: u64) -> Result<Duration> {
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
        let overrides = ProfileOverrides {
            sample_count: Some(25),
            warmup_ms: Some(11),
            calibration_min_ms: Some(12),
            target_sample_ms: Some(13),
        };
        let profile =
            RunProfile::with_overrides(BenchmarkProfile::Publish, overrides).expect("profile");
        assert_eq!(profile.sample_count, 25);
        assert_eq!(profile.warmup, Duration::from_millis(11));
        assert_eq!(profile.calibration_min, Duration::from_millis(12));
        assert_eq!(profile.target_sample, Duration::from_millis(13));
    }
}
