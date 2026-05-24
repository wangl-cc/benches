use std::time::{Duration, Instant};

use crate::{
    HarnessError, Result,
    metadata::{detect_git, detect_host},
    profile::{BenchmarkProfile, CaptureArgs, RunProfile},
    report::{MeasurementReport, RawSample, RunReport, RunReportParts, write_report},
    spec::{BenchWork, BenchmarkMetadata, BenchmarkTarget, GroupMetadata, MeasurementPoint},
    time::{rfc3339_now, run_id},
    util::{
        black_box_value, checksum_hex, checksum_mix, duration_ns, slugify, splitmix64,
        workspace_root,
    },
};

pub fn capture_benchmark(
    args: CaptureArgs,
    build_target: impl FnOnce(BenchmarkProfile) -> BenchmarkTarget,
) -> Result<()> {
    let profile = RunProfile::from_args(&args)?;
    let target = build_target(profile.profile);
    let mut points = target
        .groups()
        .iter()
        .flat_map(|group| group.points_for(profile.profile))
        .collect::<Vec<_>>();
    shuffle_points(&mut points, profile.case_order_seed);
    if points.is_empty() {
        return Err(HarnessError::new(format!(
            "benchmark {} selected no measurements",
            target.name()
        )));
    }

    let mut warnings = Vec::new();
    let created_at = rfc3339_now()?;
    let mut measurements = Vec::new();

    for point in &points {
        let calibration = calibrate(point, &profile);
        let expected_checksum = run_point(point, calibration.iterations);
        let mut observed_checksum = expected_checksum;
        let mut samples = Vec::new();

        for sample_index in 0..profile.sample_count {
            let measurement = measure_point(point, calibration.iterations);
            let checksum = measurement.checksum;
            if checksum != expected_checksum {
                return Err(HarnessError::new(format!(
                    "checksum mismatch for measurement {} sample {}: expected {}, got {}",
                    point.name(),
                    sample_index,
                    checksum_hex(expected_checksum),
                    checksum_hex(checksum)
                )));
            }
            observed_checksum = checksum;
            samples.push(RawSample {
                sample_index,
                iterations: calibration.iterations,
                elapsed_ns: duration_ns(measurement.elapsed),
                checksum: checksum_hex(checksum),
            });
        }

        measurements.push(MeasurementReport {
            metadata: point.metadata(calibration.iterations),
            samples,
            checksum: checksum_hex(observed_checksum),
        });
    }

    let report = RunReport::new(RunReportParts {
        run_id: run_id(&created_at)?,
        created_at,
        git: detect_git(&mut warnings),
        host: detect_host(&mut warnings),
        profile,
        benchmark: BenchmarkMetadata::from(&target),
        groups: target
            .groups()
            .iter()
            .map(|group| GroupMetadata::from_group(group, profile.profile))
            .collect(),
        measurements,
        warnings,
    });

    let out = args.out.unwrap_or_else(|| {
        workspace_root()
            .join("target/bench-runs")
            .join(slugify(target.name()))
            .join("latest.json")
    });
    write_report(&out, &report)
}

#[derive(Debug, Clone, Copy)]
struct Calibration {
    iterations: u64,
}

fn calibrate(point: &MeasurementPoint, profile: &RunProfile) -> Calibration {
    warmup(point, profile.warmup);

    let mut iterations = 1u64;
    loop {
        let elapsed = measure_point_elapsed(point, iterations);
        if elapsed >= profile.calibration_min {
            let elapsed_ns = duration_ns(elapsed).max(1);
            let target_ns = duration_ns(profile.target_sample).max(1);
            let calibrated = ((iterations as u128).saturating_mul(target_ns))
                .div_ceil(elapsed_ns)
                .min(u128::from(u64::MAX)) as u64;
            return Calibration {
                iterations: calibrated.max(1),
            };
        }
        iterations = iterations.saturating_mul(2).max(1);
    }
}

fn warmup(point: &MeasurementPoint, target: Duration) {
    let started = Instant::now();
    let mut iterations = 1u64;
    while started.elapsed() < target {
        run_point(point, iterations);
        iterations = (iterations.saturating_mul(2)).min(1 << 20);
    }
}

struct Measurement {
    elapsed: Duration,
    checksum: u128,
}

fn run_point(point: &MeasurementPoint, iterations: u64) -> u128 {
    let mut work = point.work();
    run_iterations(work.as_mut(), iterations)
}

fn measure_point(point: &MeasurementPoint, iterations: u64) -> Measurement {
    let mut work = point.work();
    let started = Instant::now();
    let checksum = run_iterations(work.as_mut(), iterations);
    let elapsed = started.elapsed();
    Measurement { elapsed, checksum }
}

fn measure_point_elapsed(point: &MeasurementPoint, iterations: u64) -> Duration {
    let mut work = point.work();
    let started = Instant::now();
    black_box_value(run_iterations(work.as_mut(), iterations));
    started.elapsed()
}

fn run_iterations(work: &mut dyn BenchWork, iterations: u64) -> u128 {
    let mut checksum = 0u128;
    for _ in 0..iterations {
        checksum = checksum_mix(checksum, work.run_once());
    }
    black_box_value(checksum)
}

fn shuffle_points(points: &mut [MeasurementPoint], seed: u64) {
    let mut state = seed;
    for index in (1..points.len()).rev() {
        let choice = (splitmix64(&mut state) as usize) % (index + 1);
        points.swap(index, choice);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::spec::tests::fixed_target;

    #[test]
    fn checksum_verification_is_deterministic_for_measurement_iterations() {
        let target = fixed_target();
        let point = target.groups()[0]
            .points_for(BenchmarkProfile::Quick)
            .pop()
            .expect("point");
        assert_eq!(run_point(&point, 7), run_point(&point, 7));
        assert_ne!(run_point(&point, 7), run_point(&point, 8));
    }
}
