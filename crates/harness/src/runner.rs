use std::time::{Duration, Instant};

use crate::{
    HarnessError, Result,
    metadata::{GitInfo, HostInfo},
    profile::{CaptureConfig, RunProfile},
    report::{MeasurementReport, RawSample, RunReport, RunReportParts, write_report},
    spec::{BenchWork, BenchmarkGroup, GroupMetadata, MeasurementPoint},
    time::{rfc3339_now, run_id},
    util::{duration_ns, slugify, workspace_root},
};

pub fn capture_benchmark(
    config: CaptureConfig,
    build_group: impl FnOnce() -> BenchmarkGroup,
) -> Result<()> {
    let profile = config.profile;
    let created_at = rfc3339_now()?;
    let git = GitInfo::detect()?;
    let host = HostInfo::detect()?;
    let group = build_group();
    group.validate(profile.profile)?;
    let benchmark_name = group.name().to_owned();
    let mut measurements = Vec::new();

    group.visit_points(profile.profile, &mut |point| {
        measurements.push(measure_point_report(&point, &profile)?);
        Ok(())
    })?;

    if measurements.is_empty() {
        return Err(HarnessError::new(format!(
            "benchmark {benchmark_name} selected no measurements",
        )));
    }

    let report = RunReport::new(RunReportParts {
        run_id: run_id(&created_at)?,
        created_at,
        git,
        host,
        profile,
        groups: vec![GroupMetadata::from_group(&group, profile.profile)],
        measurements,
    });

    let out = config.out.unwrap_or_else(|| {
        workspace_root()
            .join("target/bench-runs")
            .join(slugify(&benchmark_name))
            .join("latest.json")
    });
    write_report(&out, &report)
}

fn measure_point_report(
    point: &MeasurementPoint<'_>,
    profile: &RunProfile,
) -> Result<MeasurementReport> {
    let calibration = calibrate(point, profile)?;
    let mut samples = Vec::new();

    for _ in 0..profile.sample_count {
        let measurement = measure_point(point, calibration.iterations)?;
        samples.push(RawSample {
            iterations: calibration.iterations,
            elapsed_ns: duration_ns(measurement.elapsed),
        });
    }

    let metadata = point.metadata();
    Ok(MeasurementReport {
        group: metadata.group,
        case: metadata.case,
        workload_size: metadata.workload_size.amount(),
        samples,
    })
}

#[derive(Debug, Clone, Copy)]
struct Calibration {
    iterations: u64,
}

fn calibrate(point: &MeasurementPoint, profile: &RunProfile) -> Result<Calibration> {
    warmup(point, profile.warmup)?;

    let mut iterations = 1u64;
    let started = Instant::now();
    loop {
        let elapsed = measure_point_elapsed(point, iterations)?;
        if elapsed >= profile.calibration_min {
            let elapsed_ns = duration_ns(elapsed).max(1);
            let target_ns = duration_ns(profile.target_sample).max(1);
            let calibrated = ((iterations as u128).saturating_mul(target_ns))
                .div_ceil(elapsed_ns)
                .min(u128::from(u64::MAX)) as u64;
            return Ok(Calibration {
                iterations: calibrated.max(1),
            });
        }
        let next = iterations.saturating_mul(2).max(1);
        if next == iterations || started.elapsed() > profile.calibration_min.saturating_mul(100) {
            return Err(HarnessError::new(format!(
                "calibration for {:?} did not reach {:?}; case may be too fast, optimized away, or target duration is unreachable",
                point.metadata(),
                profile.calibration_min,
            )));
        }
        iterations = next;
    }
}

fn warmup(point: &MeasurementPoint, target: Duration) -> Result<()> {
    let mut warmed = Duration::ZERO;
    let mut iterations = 1u64;
    while warmed < target {
        let mut work = point.work();
        warmed += run_timed_iterations(work.as_mut(), iterations)?;
        iterations = (iterations.saturating_mul(2)).min(1 << 20);
    }
    Ok(())
}

struct Measurement {
    elapsed: Duration,
}

fn measure_point(point: &MeasurementPoint, iterations: u64) -> Result<Measurement> {
    let mut work = point.work();
    let elapsed = run_timed_iterations(work.as_mut(), iterations)?;
    Ok(Measurement { elapsed })
}

fn measure_point_elapsed(point: &MeasurementPoint, iterations: u64) -> Result<Duration> {
    let mut work = point.work();
    run_timed_iterations(work.as_mut(), iterations)
}

fn run_timed_iterations(work: &mut dyn BenchWork, iterations: u64) -> Result<Duration> {
    work.run_iterations(iterations)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        profile::BenchmarkProfile,
        spec::{BenchmarkGroup, tests::fixed_group},
    };

    #[test]
    fn point_measurement_records_elapsed_time() {
        let group = fixed_group();
        group
            .visit_points(BenchmarkProfile::Quick, &mut |point| {
                let elapsed = measure_point_elapsed(&point, 7)?;
                assert!(elapsed.as_nanos() > 0);
                Ok(())
            })
            .expect("point");
    }

    #[test]
    fn invalid_group_is_reported_as_an_error() {
        let group = BenchmarkGroup::builder("Test group")
            .quick_sizes([0])
            .publish_sizes([0])
            .prepare(|size| size.amount())
            .case(crate::spec::tests::TestCase)
            .build();

        let error = group
            .validate(BenchmarkProfile::Quick)
            .expect_err("invalid group");
        assert!(error.to_string().contains("positive"));
    }
}
