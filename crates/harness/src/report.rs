use std::{fs, path::Path};

use serde::Serialize;

use crate::{
    HarnessError, Result, SCHEMA_VERSION,
    metadata::{GitInfo, HostInfo},
    profile::{BenchmarkProfile, RunProfile},
    spec::{BenchmarkMetadata, GroupMetadata, MeasurementMetadata},
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RunReport {
    schema_version: &'static str,
    run_id: String,
    created_at: String,
    git: GitInfo,
    host: HostInfo,
    harness: HarnessInfo,
    benchmark: BenchmarkMetadata,
    groups: Vec<GroupMetadata>,
    measurements: Vec<MeasurementReport>,
    warnings: Vec<String>,
}

impl RunReport {
    pub(crate) fn new(parts: RunReportParts) -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            run_id: parts.run_id,
            created_at: parts.created_at,
            git: parts.git,
            host: parts.host,
            harness: HarnessInfo::from_profile(&parts.profile),
            benchmark: parts.benchmark,
            groups: parts.groups,
            measurements: parts.measurements,
            warnings: parts.warnings,
        }
    }
}

pub(crate) struct RunReportParts {
    pub(crate) run_id: String,
    pub(crate) created_at: String,
    pub(crate) git: GitInfo,
    pub(crate) host: HostInfo,
    pub(crate) profile: RunProfile,
    pub(crate) benchmark: BenchmarkMetadata,
    pub(crate) groups: Vec<GroupMetadata>,
    pub(crate) measurements: Vec<MeasurementReport>,
    pub(crate) warnings: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HarnessInfo {
    name: &'static str,
    version: &'static str,
    quick: bool,
    sample_count: usize,
    warmup_ms: u128,
    calibration_min_ms: u128,
    target_sample_ms: u128,
    case_order: &'static str,
    case_order_seed: String,
}

impl HarnessInfo {
    fn from_profile(profile: &RunProfile) -> Self {
        Self {
            name: "harness",
            version: env!("CARGO_PKG_VERSION"),
            quick: profile.profile == BenchmarkProfile::Quick,
            sample_count: profile.sample_count,
            warmup_ms: profile.warmup.as_millis(),
            calibration_min_ms: profile.calibration_min.as_millis(),
            target_sample_ms: profile.target_sample.as_millis(),
            case_order: "deterministic_shuffle",
            case_order_seed: format!("{:016x}", profile.case_order_seed),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MeasurementReport {
    pub(crate) metadata: MeasurementMetadata,
    pub(crate) samples: Vec<RawSample>,
    pub(crate) checksum: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RawSample {
    pub(crate) sample_index: usize,
    pub(crate) iterations: u64,
    pub(crate) elapsed_ns: u128,
    pub(crate) checksum: String,
}

pub(crate) fn write_report(path: &Path, report: &RunReport) -> Result<()> {
    let json = serde_json::to_string_pretty(report).map_err(|error| {
        HarnessError::with_source("failed to serialize benchmark report", error)
    })?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            HarnessError::with_source(
                format!("failed to create output directory {}", parent.display()),
                error,
            )
        })?;
    }
    fs::write(path, format!("{json}\n")).map_err(|error| {
        HarnessError::with_source(format!("failed to write report {}", path.display()), error)
    })
}

#[cfg(test)]
mod tests {
    use serde_json::Value;

    use super::*;
    use crate::{
        metadata::tests::{test_git, test_host},
        profile::BenchmarkProfile,
        spec::{BenchmarkMetadata, GroupMetadata, tests::fixed_target},
        util::checksum_hex,
    };

    #[test]
    fn report_serializes_schema_keys() {
        let target = fixed_target();
        let profile = RunProfile::new(BenchmarkProfile::Quick);
        let report = RunReport::new(RunReportParts {
            run_id: "test-run".to_owned(),
            created_at: "1970-01-01T00:00:00Z".to_owned(),
            git: test_git(),
            host: test_host(),
            profile,
            benchmark: BenchmarkMetadata::from(&target),
            groups: target
                .groups()
                .iter()
                .map(|group| GroupMetadata::from_group(group, profile.profile))
                .collect(),
            measurements: vec![MeasurementReport {
                metadata: target.groups()[0].points_for(profile.profile)[0].metadata(2),
                samples: vec![RawSample {
                    sample_index: 0,
                    iterations: 2,
                    elapsed_ns: 100,
                    checksum: checksum_hex(1),
                }],
                checksum: checksum_hex(1),
            }],
            warnings: Vec::new(),
        });
        let value: Value = serde_json::to_value(report).expect("json");
        assert_eq!(value["schemaVersion"], SCHEMA_VERSION);
        assert_eq!(value["harness"]["name"], "harness");
        assert_eq!(value["runId"], "test-run");
        assert!(value.get("createdAt").is_some());
        assert!(value.get("git").is_some());
        assert!(value.get("host").is_some());
        assert!(value.get("benchmark").is_some());
        assert!(value.get("groups").is_some());
        assert!(value.get("measurements").is_some());
        assert!(value.get("scopes").is_none());
        assert!(value.get("cases").is_none());
        assert!(value.get("samples").is_none());
        assert!(value.get("checksums").is_none());
        assert!(value.get("warnings").is_some());
    }
}
