use std::{fmt, sync::Arc};

use serde::Serialize;

use crate::profile::BenchmarkProfile;

pub struct BenchmarkTarget {
    name: String,
    groups: Vec<BenchmarkGroup>,
}

impl BenchmarkTarget {
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            groups: Vec::new(),
        }
    }

    pub fn group(mut self, group: BenchmarkGroup) -> Self {
        self.groups.push(group);
        self
    }

    pub(crate) fn name(&self) -> &str {
        &self.name
    }

    pub(crate) fn groups(&self) -> &[BenchmarkGroup] {
        &self.groups
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BenchmarkMetadata {
    name: String,
}

impl From<&BenchmarkTarget> for BenchmarkMetadata {
    fn from(target: &BenchmarkTarget) -> Self {
        Self {
            name: target.name.clone(),
        }
    }
}

pub struct BenchmarkGroup {
    metadata: GroupInfo,
    workload: WorkloadAxis,
    quick_sizes: Vec<WorkloadSize>,
    publish_sizes: Vec<WorkloadSize>,
    make_points: Box<dyn Fn(BenchmarkProfile) -> Vec<MeasurementPoint> + Send + Sync>,
}

impl BenchmarkGroup {
    pub fn new(name: impl Into<String>) -> GroupBuilder<NoWorkload, NoWorkload> {
        GroupBuilder {
            name: name.into(),
            description: String::new(),
            workload: WorkloadAxis {
                name: "Workload size".to_owned(),
                unit: "units".to_owned(),
            },
            quick_sizes: Vec::new(),
            publish_sizes: Vec::new(),
            prepare: NoWorkload,
            cases: Vec::new(),
        }
    }

    pub(crate) fn metadata(&self) -> &GroupInfo {
        &self.metadata
    }

    pub(crate) fn workload(&self) -> &WorkloadAxis {
        &self.workload
    }

    pub(crate) fn sizes_for(&self, profile: BenchmarkProfile) -> &[WorkloadSize] {
        match profile {
            BenchmarkProfile::Quick => &self.quick_sizes,
            BenchmarkProfile::Publish => &self.publish_sizes,
        }
    }

    pub(crate) fn points_for(&self, profile: BenchmarkProfile) -> Vec<MeasurementPoint> {
        (self.make_points)(profile)
    }
}

pub struct GroupBuilder<P, W> {
    name: String,
    description: String,
    workload: WorkloadAxis,
    quick_sizes: Vec<WorkloadSize>,
    publish_sizes: Vec<WorkloadSize>,
    prepare: P,
    cases: Vec<CaseDefinition<W>>,
}

impl<P, W> GroupBuilder<P, W> {
    pub fn description(mut self, description: impl Into<String>) -> Self {
        self.description = description.into();
        self
    }

    pub fn workload_axis(mut self, name: impl Into<String>, unit: impl Into<String>) -> Self {
        self.workload = WorkloadAxis {
            name: name.into(),
            unit: unit.into(),
        };
        self
    }

    pub fn quick_sizes<I>(mut self, sizes: I) -> Self
    where
        I: IntoIterator<Item = u64>,
    {
        self.quick_sizes = sizes.into_iter().map(WorkloadSize::new).collect();
        self
    }

    pub fn publish_sizes<I>(mut self, sizes: I) -> Self
    where
        I: IntoIterator<Item = u64>,
    {
        self.publish_sizes = sizes.into_iter().map(WorkloadSize::new).collect();
        self
    }
}

impl GroupBuilder<NoWorkload, NoWorkload> {
    pub fn prepare<W, F>(self, prepare: F) -> GroupBuilder<Arc<F>, W>
    where
        F: Fn(WorkloadSize) -> W + Send + Sync + 'static,
        W: 'static,
    {
        GroupBuilder {
            name: self.name,
            description: self.description,
            workload: self.workload,
            quick_sizes: self.quick_sizes,
            publish_sizes: self.publish_sizes,
            prepare: Arc::new(prepare),
            cases: Vec::new(),
        }
    }
}

impl<W, F> GroupBuilder<Arc<F>, W>
where
    F: Fn(WorkloadSize) -> W + Send + Sync + 'static,
    W: 'static,
{
    pub fn case<R>(mut self, name: impl Into<String>, color: impl Into<String>, run: R) -> Self
    where
        R: Fn(&mut W) -> u128 + Send + Sync + 'static,
    {
        self.cases.push(CaseDefinition {
            name: name.into(),
            color: color.into(),
            run: Arc::new(run),
        });
        self
    }

    pub fn build(self) -> BenchmarkGroup {
        let metadata = GroupInfo {
            name: self.name,
            description: self.description,
        };
        let workload = self.workload;
        let quick_sizes = self.quick_sizes;
        let publish_sizes = self.publish_sizes;
        let prepare = self.prepare;
        let cases = self.cases;

        BenchmarkGroup {
            metadata: metadata.clone(),
            workload: workload.clone(),
            quick_sizes: quick_sizes.clone(),
            publish_sizes: publish_sizes.clone(),
            make_points: Box::new(move |profile| {
                let sizes = match profile {
                    BenchmarkProfile::Quick => &quick_sizes,
                    BenchmarkProfile::Publish => &publish_sizes,
                };
                let mut points = Vec::new();
                for &size in sizes {
                    for case in &cases {
                        let prepare = Arc::clone(&prepare);
                        let run = Arc::clone(&case.run);
                        points.push(MeasurementPoint {
                            metadata: MeasurementMetadata {
                                group: metadata.name.clone(),
                                case: case.name.clone(),
                                case_color: case.color.clone(),
                                workload: workload.clone(),
                                workload_size: size,
                                calibrated_iterations: None,
                            },
                            work: Box::new(move || {
                                Box::new(PreparedWork {
                                    workload: prepare(size),
                                    run: Arc::clone(&run),
                                }) as Box<dyn BenchWork>
                            }),
                        });
                    }
                }
                points
            }),
        }
    }
}

#[derive(Debug)]
pub struct NoWorkload;

struct CaseDefinition<W> {
    name: String,
    color: String,
    run: Arc<dyn Fn(&mut W) -> u128 + Send + Sync>,
}

struct PreparedWork<W> {
    workload: W,
    run: Arc<dyn Fn(&mut W) -> u128 + Send + Sync>,
}

impl<W> BenchWork for PreparedWork<W> {
    fn run_once(&mut self) -> u128 {
        (self.run)(&mut self.workload)
    }
}

pub(crate) struct MeasurementPoint {
    metadata: MeasurementMetadata,
    work: Box<dyn Fn() -> Box<dyn BenchWork> + Send + Sync>,
}

impl MeasurementPoint {
    pub(crate) fn name(&self) -> String {
        format!(
            "{} / {} / {} {}",
            self.metadata.group,
            self.metadata.case,
            self.metadata.workload_size.amount,
            self.metadata.workload.unit
        )
    }

    pub(crate) fn metadata(&self, calibrated_iterations: u64) -> MeasurementMetadata {
        let mut metadata = self.metadata.clone();
        metadata.calibrated_iterations = Some(calibrated_iterations);
        metadata
    }

    pub(crate) fn work(&self) -> Box<dyn BenchWork> {
        (self.work)()
    }
}

impl fmt::Debug for MeasurementPoint {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("MeasurementPoint")
            .field("metadata", &self.metadata)
            .finish_non_exhaustive()
    }
}

#[derive(Clone, Debug)]
pub(crate) struct GroupInfo {
    name: String,
    description: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GroupMetadata {
    name: String,
    description: String,
    workload: WorkloadAxis,
    sizes: Vec<WorkloadSize>,
    cases: Vec<CaseMetadata>,
}

impl GroupMetadata {
    pub(crate) fn from_group(group: &BenchmarkGroup, profile: BenchmarkProfile) -> Self {
        let cases = group
            .points_for(profile)
            .into_iter()
            .map(|point| CaseMetadata {
                name: point.metadata.case,
                color: point.metadata.case_color,
            })
            .fold(Vec::<CaseMetadata>::new(), |mut unique, case| {
                if !unique.iter().any(|existing| existing.name == case.name) {
                    unique.push(case);
                }
                unique
            });
        Self {
            name: group.metadata().name.clone(),
            description: group.metadata().description.clone(),
            workload: group.workload().clone(),
            sizes: group.sizes_for(profile).to_vec(),
            cases,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CaseMetadata {
    name: String,
    color: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MeasurementMetadata {
    pub(crate) group: String,
    pub(crate) case: String,
    pub(crate) case_color: String,
    pub(crate) workload: WorkloadAxis,
    pub(crate) workload_size: WorkloadSize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) calibrated_iterations: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkloadAxis {
    name: String,
    unit: String,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkloadSize {
    amount: u64,
}

impl WorkloadSize {
    pub fn new(amount: u64) -> Self {
        Self { amount }
    }

    pub fn amount(self) -> u64 {
        self.amount
    }
}

pub trait BenchWork {
    fn run_once(&mut self) -> u128;
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub(crate) fn fixed_target() -> BenchmarkTarget {
        BenchmarkTarget::new("Test benchmark").group(
            BenchmarkGroup::new("Test group")
                .description("Test workload.")
                .workload_axis("Items", "items")
                .quick_sizes([1])
                .publish_sizes([1])
                .prepare(|size| size.amount())
                .case("algorithm", "#64748b", |value| u128::from(*value))
                .build(),
        )
    }
}
