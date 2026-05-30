use std::{env, fs, path::Path};

use serde::Serialize;

use crate::{
    HarnessError, Result, SCHEMA_VERSION,
    metadata::{GitInfo, HostInfo},
    profile::{BenchmarkProfile, RunProfile},
    spec::GroupMetadata,
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
    groups: Vec<GroupMetadata>,
    measurements: Vec<MeasurementReport>,
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
            groups: parts.groups,
            measurements: parts.measurements,
        }
    }
}

pub(crate) struct RunReportParts {
    pub(crate) run_id: String,
    pub(crate) created_at: String,
    pub(crate) git: GitInfo,
    pub(crate) host: HostInfo,
    pub(crate) profile: RunProfile,
    pub(crate) groups: Vec<GroupMetadata>,
    pub(crate) measurements: Vec<MeasurementReport>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HarnessInfo {
    name: &'static str,
    version: &'static str,
    profile: &'static str,
    sample_count: usize,
    warmup_ms: u128,
    calibration_min_ms: u128,
    target_sample_ms: u128,
    build: BuildInfo,
}

impl HarnessInfo {
    fn from_profile(profile: &RunProfile) -> Self {
        Self {
            name: "harness",
            version: env!("CARGO_PKG_VERSION"),
            profile: match profile.profile {
                BenchmarkProfile::Quick => "quick",
                BenchmarkProfile::Publish => "publish",
            },
            sample_count: profile.sample_count,
            warmup_ms: profile.warmup.as_millis(),
            calibration_min_ms: profile.calibration_min.as_millis(),
            target_sample_ms: profile.target_sample.as_millis(),
            build: BuildInfo::detect(),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BuildInfo {
    rustflags: Vec<String>,
}

impl BuildInfo {
    fn detect() -> Self {
        Self {
            rustflags: configured_rustflags(),
        }
    }
}

fn configured_rustflags() -> Vec<String> {
    if let Ok(encoded) = env::var("CARGO_ENCODED_RUSTFLAGS") {
        let flags = encoded
            .split('\u{1f}')
            .filter(|flag| !flag.is_empty())
            .map(ToOwned::to_owned)
            .collect::<Vec<_>>();
        if !flags.is_empty() {
            return flags;
        }
    }

    if let Ok(flags) = env::var("RUSTFLAGS") {
        let flags = flags
            .split_whitespace()
            .filter(|flag| !flag.is_empty())
            .map(ToOwned::to_owned)
            .collect::<Vec<_>>();
        if !flags.is_empty() {
            return flags;
        }
    }

    cargo_config_rustflags()
}

fn cargo_config_rustflags() -> Vec<String> {
    let Ok(config) = fs::read_to_string(crate::util::workspace_root().join(".cargo/config.toml"))
    else {
        return Vec::new();
    };
    parse_rustflags_array(&config).unwrap_or_default()
}

fn parse_rustflags_array(config: &str) -> Option<Vec<String>> {
    let rustflags_offset = config.find("rustflags")?;
    let after_rustflags = &config[rustflags_offset..];
    let start = after_rustflags.find('[')? + 1;
    let after_start = &after_rustflags[start..];
    let end = after_start.find(']')?;
    let array = &after_start[..end];
    let mut flags = Vec::new();
    let mut rest = array;
    while let Some(start_quote) = rest.find('"') {
        let after_quote = &rest[start_quote + 1..];
        let Some(end_quote) = after_quote.find('"') else {
            break;
        };
        let flag = &after_quote[..end_quote];
        if !flag.is_empty() {
            flags.push(flag.to_owned());
        }
        rest = &after_quote[end_quote + 1..];
    }
    Some(flags)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MeasurementReport {
    pub(crate) group: String,
    pub(crate) case: String,
    pub(crate) workload_size: u64,
    pub(crate) samples: Vec<RawSample>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RawSample {
    pub(crate) iterations: u64,
    pub(crate) elapsed_ns: u128,
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
        spec::{GroupMetadata, tests::fixed_group},
    };

    #[test]
    fn report_serializes_schema_keys() {
        let group = fixed_group();
        let profile = RunProfile::new(BenchmarkProfile::Quick);
        let mut metadata = None;
        group
            .visit_points(profile.profile, &mut |point| {
                metadata = Some(point.metadata());
                Ok(())
            })
            .expect("metadata point");
        let report = RunReport::new(RunReportParts {
            run_id: "test-run".to_owned(),
            created_at: "1970-01-01T00:00:00Z".to_owned(),
            git: test_git(),
            host: test_host(),
            profile,
            groups: vec![GroupMetadata::from_group(&group, profile.profile)],
            measurements: vec![MeasurementReport {
                group: metadata.expect("metadata").group,
                case: "algorithm".to_owned(),
                workload_size: 1,
                samples: vec![RawSample {
                    iterations: 2,
                    elapsed_ns: 100,
                }],
            }],
        });
        let value: Value = serde_json::to_value(report).expect("json");
        assert_eq!(value["schemaVersion"], SCHEMA_VERSION);
        assert_eq!(value["harness"]["name"], "harness");
        assert_eq!(value["harness"]["profile"], "quick");
        assert!(
            value["harness"]["build"]["rustflags"]
                .as_array()
                .expect("rustflags array")
                .iter()
                .any(|flag| flag == "-Ctarget-cpu=native")
        );
        let mut top_level_keys = value
            .as_object()
            .expect("run report object")
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>();
        top_level_keys.sort_unstable();
        assert_eq!(top_level_keys, vec![
            "createdAt",
            "git",
            "groups",
            "harness",
            "host",
            "measurements",
            "runId",
            "schemaVersion",
        ]);
        assert_eq!(value["runId"], "test-run");
        assert!(value.get("createdAt").is_some());
        assert!(value.get("git").is_some());
        assert!(value.get("host").is_some());
        assert!(value.get("groups").is_some());
        assert!(value.get("measurements").is_some());
        assert_eq!(value["groups"][0]["sizes"][0], 1);
        assert_eq!(value["measurements"][0]["workloadSize"], 1);
        let mut measurement_keys = value["measurements"][0]
            .as_object()
            .expect("measurement object")
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>();
        measurement_keys.sort_unstable();
        assert_eq!(measurement_keys, vec![
            "case",
            "group",
            "samples",
            "workloadSize"
        ]);
    }
}
