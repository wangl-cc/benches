use std::{
    collections::HashSet,
    fmt,
    hint::black_box,
    marker::PhantomData,
    time::{Duration, Instant},
};

use serde::Serialize;

use crate::{HarnessError, Result, profile::BenchmarkProfile};

pub struct BenchmarkGroup {
    inner: Box<dyn ErasedGroup>,
}

impl BenchmarkGroup {
    pub fn builder(name: impl Into<String>) -> GroupBuilder<NoWorkload, NoWorkload> {
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
        self.inner.metadata()
    }

    pub(crate) fn name(&self) -> &str {
        &self.metadata().name
    }

    pub(crate) fn workload(&self) -> &WorkloadAxis {
        self.inner.workload()
    }

    pub(crate) fn sizes_for(&self, profile: BenchmarkProfile) -> &[WorkloadSize] {
        self.inner.sizes_for(profile)
    }

    pub(crate) fn case_metadata(&self) -> Vec<CaseMetadata> {
        self.inner.case_metadata()
    }

    pub(crate) fn visit_points(
        &self,
        profile: BenchmarkProfile,
        visitor: &mut dyn FnMut(MeasurementPoint<'_>) -> Result<()>,
    ) -> Result<()> {
        self.inner.visit_points(profile, visitor)
    }

    pub(crate) fn validate(&self, profile: BenchmarkProfile) -> Result<()> {
        self.inner.validate(profile)
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
    pub fn prepare<W, F>(self, prepare: F) -> GroupBuilder<F, W>
    where
        F: Fn(WorkloadSize) -> W + 'static,
        W: 'static,
    {
        GroupBuilder {
            name: self.name,
            description: self.description,
            workload: self.workload,
            quick_sizes: self.quick_sizes,
            publish_sizes: self.publish_sizes,
            prepare,
            cases: Vec::new(),
        }
    }
}

impl<W, F> GroupBuilder<F, W>
where
    F: Fn(WorkloadSize) -> W + 'static,
    W: 'static,
{
    pub fn case<C>(self, case: C) -> Self
    where
        C: BenchmarkCase<W> + 'static,
        C::State: 'static,
        C::Output: 'static,
    {
        self.case_erased(Box::new(CaseAdapter { case }))
    }

    fn case_erased(mut self, case: Box<dyn ErasedCase<W>>) -> Self {
        self.cases.push(CaseDefinition { case });
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
        BenchmarkGroup {
            inner: Box::new(TypedGroup {
                metadata,
                workload,
                quick_sizes,
                publish_sizes,
                prepare: self.prepare,
                cases: self.cases,
            }),
        }
    }
}

#[derive(Debug)]
pub struct NoWorkload;

struct CaseDefinition<W> {
    case: Box<dyn ErasedCase<W>>,
}

struct CaseAdapter<C> {
    case: C,
}

impl<W, C> ErasedCase<W> for CaseAdapter<C>
where
    W: 'static,
    C: BenchmarkCase<W> + 'static,
    C::State: 'static,
    C::Output: 'static,
{
    fn name(&self) -> &'static str {
        self.case.name()
    }

    fn color(&self) -> &'static str {
        self.case.color()
    }

    fn make_work<'a>(&'a self, workload: W) -> Box<dyn BenchWork + 'a> {
        Box::new(CaseWork::<W, C> {
            case: &self.case,
            state: self.case.prepare(workload),
            _workload: PhantomData,
        })
    }
}

pub trait BenchmarkCase<W> {
    type State;
    type Output;

    fn name(&self) -> &'static str;

    fn color(&self) -> &'static str;

    fn prepare(&self, workload: W) -> Self::State;

    fn run_once(&self, state: &mut Self::State) -> Self::Output;
}

trait ErasedCase<W> {
    fn name(&self) -> &'static str;

    fn color(&self) -> &'static str;

    fn make_work<'a>(&'a self, workload: W) -> Box<dyn BenchWork + 'a>;
}

struct CaseWork<'a, W, C>
where
    C: BenchmarkCase<W>,
{
    case: &'a C,
    state: C::State,
    _workload: PhantomData<W>,
}

impl<W, C> BenchWork for CaseWork<'_, W, C>
where
    C: BenchmarkCase<W>,
{
    fn run_iterations(&mut self, iterations: u64) -> Result<Duration> {
        let started = Instant::now();
        for _ in 0..iterations {
            let output = self.case.run_once(black_box(&mut self.state));
            black_box(output);
        }
        Ok(started.elapsed())
    }
}

trait ErasedGroup {
    fn metadata(&self) -> &GroupInfo;

    fn workload(&self) -> &WorkloadAxis;

    fn sizes_for(&self, profile: BenchmarkProfile) -> &[WorkloadSize];

    fn case_metadata(&self) -> Vec<CaseMetadata>;

    fn visit_points(
        &self,
        profile: BenchmarkProfile,
        visitor: &mut dyn FnMut(MeasurementPoint<'_>) -> Result<()>,
    ) -> Result<()>;

    fn validate(&self, profile: BenchmarkProfile) -> Result<()>;
}

struct TypedGroup<W, F> {
    metadata: GroupInfo,
    workload: WorkloadAxis,
    quick_sizes: Vec<WorkloadSize>,
    publish_sizes: Vec<WorkloadSize>,
    prepare: F,
    cases: Vec<CaseDefinition<W>>,
}

impl<W, F> ErasedGroup for TypedGroup<W, F>
where
    F: Fn(WorkloadSize) -> W + 'static,
    W: 'static,
{
    fn metadata(&self) -> &GroupInfo {
        &self.metadata
    }

    fn workload(&self) -> &WorkloadAxis {
        &self.workload
    }

    fn sizes_for(&self, profile: BenchmarkProfile) -> &[WorkloadSize] {
        match profile {
            BenchmarkProfile::Quick => &self.quick_sizes,
            BenchmarkProfile::Publish => &self.publish_sizes,
        }
    }

    fn case_metadata(&self) -> Vec<CaseMetadata> {
        self.cases
            .iter()
            .map(|case| CaseMetadata {
                name: case.case.name().to_owned(),
                color: case.case.color().to_owned(),
            })
            .collect()
    }

    fn visit_points(
        &self,
        profile: BenchmarkProfile,
        visitor: &mut dyn FnMut(MeasurementPoint<'_>) -> Result<()>,
    ) -> Result<()> {
        for &size in self.sizes_for(profile) {
            for case in &self.cases {
                visitor(MeasurementPoint {
                    metadata: MeasurementMetadata {
                        group: self.metadata.name.clone(),
                        case: case.case.name().to_owned(),
                        workload_size: size,
                    },
                    work: Box::new(move || {
                        let workload = (self.prepare)(size);
                        case.case.make_work(workload)
                    }),
                })?;
            }
        }
        Ok(())
    }

    fn validate(&self, profile: BenchmarkProfile) -> Result<()> {
        validate_group(
            &self.metadata,
            &self.workload,
            self.sizes_for(profile),
            self.cases.iter().map(|case| case.case.as_ref()),
        )
    }
}

pub(crate) struct MeasurementPoint<'a> {
    metadata: MeasurementMetadata,
    work: Box<dyn Fn() -> Box<dyn BenchWork + 'a> + 'a>,
}

impl MeasurementPoint<'_> {
    pub(crate) fn metadata(&self) -> MeasurementMetadata {
        self.metadata.clone()
    }

    pub(crate) fn work(&self) -> Box<dyn BenchWork + '_> {
        (self.work)()
    }
}

impl fmt::Debug for MeasurementPoint<'_> {
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
        Self {
            name: group.metadata().name.clone(),
            description: group.metadata().description.clone(),
            workload: group.workload().clone(),
            sizes: group.sizes_for(profile).to_vec(),
            cases: group.case_metadata(),
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
    pub(crate) workload_size: WorkloadSize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkloadAxis {
    name: String,
    unit: String,
}

#[derive(Clone, Copy, Debug)]
pub struct WorkloadSize {
    amount: u64,
}

impl Serialize for WorkloadSize {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_u64(self.amount)
    }
}

impl WorkloadSize {
    pub fn new(amount: u64) -> Self {
        Self { amount }
    }

    pub fn amount(self) -> u64 {
        self.amount
    }
}

pub(crate) trait BenchWork {
    fn run_iterations(&mut self, iterations: u64) -> Result<Duration>;
}

fn validate_group<'a, W>(
    metadata: &GroupInfo,
    workload: &WorkloadAxis,
    sizes: &[WorkloadSize],
    cases: impl IntoIterator<Item = &'a dyn ErasedCase<W>>,
) -> Result<()>
where
    W: 'a,
{
    let mut errors = Vec::new();

    if metadata.name.trim().is_empty() {
        errors.push("group name must not be empty".to_owned());
    }
    if workload.name.trim().is_empty() {
        errors.push("workload axis name must not be empty".to_owned());
    }
    if workload.unit.trim().is_empty() {
        errors.push("workload axis unit must not be empty".to_owned());
    }
    if sizes.is_empty() {
        errors.push("selected profile must define at least one workload size".to_owned());
    }

    let mut seen_sizes = HashSet::new();
    for size in sizes {
        if size.amount() == 0 {
            errors.push("workload sizes must be positive".to_owned());
        }
        if !seen_sizes.insert(size.amount()) {
            errors.push(format!("duplicate workload size {}", size.amount()));
        }
    }

    let cases = cases.into_iter().collect::<Vec<_>>();
    if cases.is_empty() {
        errors.push("group must define at least one case".to_owned());
    }

    let mut seen_cases = HashSet::new();
    for case in cases {
        let name = case.name();
        if name.trim().is_empty() {
            errors.push("case name must not be empty".to_owned());
        }
        if !seen_cases.insert(name) {
            errors.push(format!("duplicate case name {name}"));
        }
        if !is_hex_color(case.color()) {
            errors.push(format!("case {name} color must use #rrggbb hex format"));
        }
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(HarnessError::new(format!(
            "invalid benchmark group {}: {}",
            metadata.name,
            errors.join("; ")
        )))
    }
}

fn is_hex_color(color: &str) -> bool {
    let Some(hex) = color.strip_prefix('#') else {
        return false;
    };
    hex.len() == 6 && hex.bytes().all(|byte| byte.is_ascii_hexdigit())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub(crate) fn fixed_group() -> BenchmarkGroup {
        BenchmarkGroup::builder("Test group")
            .description("Test workload.")
            .workload_axis("Items", "items")
            .quick_sizes([1])
            .publish_sizes([1])
            .prepare(|size| size.amount())
            .case(TestCase)
            .build()
    }

    pub(crate) struct TestCase;

    impl BenchmarkCase<u64> for TestCase {
        type Output = u64;
        type State = u64;

        fn name(&self) -> &'static str {
            "algorithm"
        }

        fn color(&self) -> &'static str {
            "#64748b"
        }

        fn prepare(&self, value: u64) -> Self::State {
            value
        }

        fn run_once(&self, value: &mut Self::State) -> Self::Output {
            *value += 1;
            *value
        }
    }

    struct StringCase;

    impl BenchmarkCase<u64> for StringCase {
        type Output = String;
        type State = u64;

        fn name(&self) -> &'static str {
            "string-algorithm"
        }

        fn color(&self) -> &'static str {
            "#ef4444"
        }

        fn prepare(&self, value: u64) -> Self::State {
            value
        }

        fn run_once(&self, value: &mut Self::State) -> Self::Output {
            *value += 1;
            value.to_string()
        }
    }

    #[test]
    fn heterogeneous_case_outputs_share_one_group() {
        let group = BenchmarkGroup::builder("Mixed group")
            .workload_axis("Items", "items")
            .quick_sizes([1])
            .publish_sizes([1])
            .prepare(|size| size.amount())
            .case(TestCase)
            .case(StringCase)
            .build();

        let mut points = 0;
        group
            .visit_points(BenchmarkProfile::Quick, &mut |point| {
                let mut work = point.work();
                work.run_iterations(1)?;
                points += 1;
                Ok(())
            })
            .expect("points");
        assert_eq!(points, 2);
    }

    #[test]
    fn validation_rejects_duplicate_cases() {
        let group = BenchmarkGroup::builder("Duplicate group")
            .workload_axis("Items", "items")
            .quick_sizes([1])
            .publish_sizes([1])
            .prepare(|size| size.amount())
            .case(TestCase)
            .case(TestCase)
            .build();

        let error = group
            .validate(BenchmarkProfile::Quick)
            .expect_err("duplicate case");
        assert!(error.to_string().contains("duplicate case"));
    }
}
