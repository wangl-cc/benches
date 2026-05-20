use std::{
    collections::{BTreeMap, HashMap},
    hash::Hash,
    hint::black_box,
};

use criterion::{
    AxisScale, BatchSize, BenchmarkId, Criterion, PlotConfiguration, Throughput, criterion_group,
    criterion_main,
};
use indexmap::IndexMap;
use nohash_hasher::BuildNoHashHasher;
use rand::{Rng, SeedableRng, rngs::SmallRng};

const LARGE_ENTRY_COUNT: usize = 1 << 16;
const ENTRY_COUNTS: &[usize] = &[16, 256, 4096, LARGE_ENTRY_COUNT];
const SEED: u64 = 42;

type BenchGroup<'a> = criterion::BenchmarkGroup<'a, criterion::measurement::WallTime>;

#[derive(Debug)]
struct Workload<K> {
    label: &'static str,
    entries: Vec<(K, u64)>,
    hit_keys: Vec<K>,
    missing_keys: Vec<K>,
    replacements: Vec<(K, u64)>,
}

trait MapOps<K>: Sized {
    const NAME: &'static str;

    fn with_capacity(capacity: usize) -> Self;
    fn insert(&mut self, key: K, value: u64);
    fn remove(&mut self, key: &K) -> Option<u64>;
    fn get(&self, key: &K) -> Option<&u64>;
    fn iter_xor(&self) -> u64;
    fn len(&self) -> usize;
}

struct RapidHashMap<K>(HashMap<K, u64, rapidhash::fast::RandomState>);

impl<K: Eq + Hash> MapOps<K> for RapidHashMap<K> {
    const NAME: &'static str = "HashMap-rapidhash";

    fn with_capacity(capacity: usize) -> Self {
        Self(HashMap::with_capacity_and_hasher(
            capacity,
            rapidhash::fast::RandomState::default(),
        ))
    }

    fn insert(&mut self, key: K, value: u64) {
        self.0.insert(key, value);
    }

    fn remove(&mut self, key: &K) -> Option<u64> {
        self.0.remove(key)
    }

    fn get(&self, key: &K) -> Option<&u64> {
        self.0.get(key)
    }

    fn iter_xor(&self) -> u64 {
        self.0.values().fold(0, |acc, value| acc ^ *value)
    }

    fn len(&self) -> usize {
        self.0.len()
    }
}

struct NoHashMap(HashMap<u64, u64, BuildNoHashHasher<u64>>);

impl MapOps<u64> for NoHashMap {
    const NAME: &'static str = "HashMap-nohash";

    fn with_capacity(capacity: usize) -> Self {
        Self(HashMap::with_capacity_and_hasher(
            capacity,
            BuildNoHashHasher::default(),
        ))
    }

    fn insert(&mut self, key: u64, value: u64) {
        self.0.insert(key, value);
    }

    fn remove(&mut self, key: &u64) -> Option<u64> {
        self.0.remove(key)
    }

    fn get(&self, key: &u64) -> Option<&u64> {
        self.0.get(key)
    }

    fn iter_xor(&self) -> u64 {
        self.0.values().fold(0, |acc, value| acc ^ *value)
    }

    fn len(&self) -> usize {
        self.0.len()
    }
}

struct BTreeMapBench<K>(BTreeMap<K, u64>);

impl<K: Ord> MapOps<K> for BTreeMapBench<K> {
    const NAME: &'static str = "BTreeMap";

    fn with_capacity(_capacity: usize) -> Self {
        Self(BTreeMap::new())
    }

    fn insert(&mut self, key: K, value: u64) {
        self.0.insert(key, value);
    }

    fn remove(&mut self, key: &K) -> Option<u64> {
        self.0.remove(key)
    }

    fn get(&self, key: &K) -> Option<&u64> {
        self.0.get(key)
    }

    fn iter_xor(&self) -> u64 {
        self.0.values().fold(0, |acc, value| acc ^ *value)
    }

    fn len(&self) -> usize {
        self.0.len()
    }
}

struct RapidIndexMap<K>(IndexMap<K, u64, rapidhash::fast::RandomState>);

impl<K: Eq + Hash> MapOps<K> for RapidIndexMap<K> {
    const NAME: &'static str = "IndexMap-rapidhash";

    fn with_capacity(capacity: usize) -> Self {
        Self(IndexMap::with_capacity_and_hasher(
            capacity,
            rapidhash::fast::RandomState::default(),
        ))
    }

    fn insert(&mut self, key: K, value: u64) {
        self.0.insert(key, value);
    }

    fn remove(&mut self, key: &K) -> Option<u64> {
        self.0.swap_remove(key)
    }

    fn get(&self, key: &K) -> Option<&u64> {
        self.0.get(key)
    }

    fn iter_xor(&self) -> u64 {
        self.0.values().fold(0, |acc, value| acc ^ *value)
    }

    fn len(&self) -> usize {
        self.0.len()
    }
}

struct NoHashIndexMap(IndexMap<u64, u64, BuildNoHashHasher<u64>>);

impl MapOps<u64> for NoHashIndexMap {
    const NAME: &'static str = "IndexMap-nohash";

    fn with_capacity(capacity: usize) -> Self {
        Self(IndexMap::with_capacity_and_hasher(
            capacity,
            BuildNoHashHasher::default(),
        ))
    }

    fn insert(&mut self, key: u64, value: u64) {
        self.0.insert(key, value);
    }

    fn remove(&mut self, key: &u64) -> Option<u64> {
        self.0.swap_remove(key)
    }

    fn get(&self, key: &u64) -> Option<&u64> {
        self.0.get(key)
    }

    fn iter_xor(&self) -> u64 {
        self.0.values().fold(0, |acc, value| acc ^ *value)
    }

    fn len(&self) -> usize {
        self.0.len()
    }
}

struct VecPair<K>(Vec<(K, u64)>);

impl<K: Eq> MapOps<K> for VecPair<K> {
    const NAME: &'static str = "VecPair";

    fn with_capacity(capacity: usize) -> Self {
        Self(Vec::with_capacity(capacity))
    }

    fn insert(&mut self, key: K, value: u64) {
        self.0.push((key, value));
    }

    fn remove(&mut self, key: &K) -> Option<u64> {
        let index = self.0.iter().position(|(candidate, _)| candidate == key)?;
        Some(self.0.swap_remove(index).1)
    }

    fn get(&self, key: &K) -> Option<&u64> {
        self.0
            .iter()
            .find_map(|(candidate, value)| (candidate == key).then_some(value))
    }

    fn iter_xor(&self) -> u64 {
        self.0.iter().fold(0, |acc, (_, value)| acc ^ *value)
    }

    fn len(&self) -> usize {
        self.0.len()
    }
}

fn build_map<M, K>(entries: &[(K, u64)], extra_capacity: usize) -> M
where
    M: MapOps<K>,
    K: Copy,
{
    let mut map = M::with_capacity(entries.len() + extra_capacity);
    for &(key, value) in entries {
        map.insert(key, value);
    }
    map
}

fn bench_id<M, K>(workload: &Workload<K>) -> BenchmarkId
where
    M: MapOps<K>,
{
    BenchmarkId::new(
        format!("{} {}", M::NAME, workload.label),
        workload.entries.len(),
    )
}

fn bench_insert_batch<M, K>(group: &mut BenchGroup<'_>, workload: &Workload<K>)
where
    M: MapOps<K>,
    K: Copy,
{
    group.bench_with_input(bench_id::<M, K>(workload), workload, |b, workload| {
        b.iter_batched(
            || M::with_capacity(workload.entries.len()),
            |mut map| {
                for &(key, value) in &workload.entries {
                    map.insert(black_box(key), black_box(value));
                }
                black_box(map.len());
            },
            BatchSize::LargeInput,
        );
    });
}

fn bench_remove_batch<M, K>(group: &mut BenchGroup<'_>, workload: &Workload<K>)
where
    M: MapOps<K>,
    K: Copy,
{
    group.bench_with_input(bench_id::<M, K>(workload), workload, |b, workload| {
        b.iter_batched(
            || build_map::<M, K>(&workload.entries, 0),
            |mut map| {
                let mut acc = 0u64;
                for key in &workload.hit_keys {
                    if let Some(value) = map.remove(black_box(key)) {
                        acc ^= value;
                    }
                }
                black_box((map.len(), acc));
            },
            BatchSize::LargeInput,
        );
    });
}

fn bench_lookup_hit<M, K>(group: &mut BenchGroup<'_>, workload: &Workload<K>)
where
    M: MapOps<K>,
    K: Copy,
{
    let map = build_map::<M, K>(&workload.entries, 0);
    group.bench_with_input(bench_id::<M, K>(workload), workload, |b, workload| {
        b.iter(|| {
            let mut acc = 0u64;
            for key in &workload.hit_keys {
                if let Some(value) = map.get(black_box(key)) {
                    acc ^= *value;
                }
            }
            black_box(acc);
        });
    });
}

fn bench_lookup_missing<M, K>(group: &mut BenchGroup<'_>, workload: &Workload<K>)
where
    M: MapOps<K>,
    K: Copy,
{
    let map = build_map::<M, K>(&workload.entries, 0);
    group.bench_with_input(bench_id::<M, K>(workload), workload, |b, workload| {
        b.iter(|| {
            let mut acc = 0u64;
            for key in &workload.missing_keys {
                acc ^= map.get(black_box(key)).map_or(0, |value| *value);
            }
            black_box(acc);
        });
    });
}

fn bench_iter<M, K>(group: &mut BenchGroup<'_>, workload: &Workload<K>)
where
    M: MapOps<K>,
    K: Copy,
{
    let map = build_map::<M, K>(&workload.entries, 0);
    group.bench_with_input(bench_id::<M, K>(workload), workload, |b, _workload| {
        b.iter(|| black_box(map.iter_xor()));
    });
}

fn bench_churn<M, K>(group: &mut BenchGroup<'_>, workload: &Workload<K>)
where
    M: MapOps<K>,
    K: Copy,
{
    group.bench_with_input(bench_id::<M, K>(workload), workload, |b, workload| {
        b.iter_batched(
            || build_map::<M, K>(&workload.entries, workload.replacements.len()),
            |mut map| {
                let mut acc = 0u64;
                for (remove_key, &(insert_key, insert_value)) in
                    workload.hit_keys.iter().zip(&workload.replacements)
                {
                    if let Some(value) = map.remove(black_box(remove_key)) {
                        acc ^= value;
                    }
                    map.insert(black_box(insert_key), black_box(insert_value));
                }
                black_box((map.len(), acc));
            },
            BatchSize::LargeInput,
        );
    });
}

macro_rules! bench_common_maps {
    ($bench_fn:ident, $group:expr, $workload:expr, $key:ty, $include_vecpair:expr) => {{
        $bench_fn::<RapidHashMap<$key>, $key>($group, &$workload);
        $bench_fn::<BTreeMapBench<$key>, $key>($group, &$workload);
        $bench_fn::<RapidIndexMap<$key>, $key>($group, &$workload);
        if $include_vecpair {
            $bench_fn::<VecPair<$key>, $key>($group, &$workload);
        }
    }};
}

macro_rules! bench_u64_maps {
    ($bench_fn:ident, $group:expr, $workload:expr, $include_vecpair:expr) => {{
        $bench_fn::<RapidHashMap<u64>, u64>($group, &$workload);
        $bench_fn::<NoHashMap, u64>($group, &$workload);
        $bench_fn::<BTreeMapBench<u64>, u64>($group, &$workload);
        $bench_fn::<RapidIndexMap<u64>, u64>($group, &$workload);
        $bench_fn::<NoHashIndexMap, u64>($group, &$workload);
        if $include_vecpair {
            $bench_fn::<VecPair<u64>, u64>($group, &$workload);
        }
    }};
}

macro_rules! bench_all_workloads {
    ($group:expr, $bench_fn:ident, $include_large_vecpair:expr) => {{
        for &count in ENTRY_COUNTS {
            $group.throughput(Throughput::Elements(count as u64));
            let include_vecpair = $include_large_vecpair || count != LARGE_ENTRY_COUNT;

            let workload = workload_u64(count);
            bench_u64_maps!($bench_fn, $group, workload, include_vecpair);

            let workload = workload_bytes::<16>(count, "bytes16");
            bench_common_maps!($bench_fn, $group, workload, [u8; 16], include_vecpair);

            let workload = workload_bytes::<64>(count, "bytes64");
            bench_common_maps!($bench_fn, $group, workload, [u8; 64], include_vecpair);

            let workload = workload_bytes::<256>(count, "bytes256");
            bench_common_maps!($bench_fn, $group, workload, [u8; 256], include_vecpair);
        }
    }};
}

fn map_insert_batch(c: &mut Criterion) {
    let mut group = benchmark_group(c, "map_insert_batch");
    bench_all_workloads!(&mut group, bench_insert_batch, true);
    group.finish();
}

fn map_remove_batch(c: &mut Criterion) {
    let mut group = benchmark_group(c, "map_remove_batch");
    bench_all_workloads!(&mut group, bench_remove_batch, false);
    group.finish();
}

fn map_lookup_hit(c: &mut Criterion) {
    let mut group = benchmark_group(c, "map_lookup_hit");
    bench_all_workloads!(&mut group, bench_lookup_hit, false);
    group.finish();
}

fn map_lookup_missing(c: &mut Criterion) {
    let mut group = benchmark_group(c, "map_lookup_missing");
    bench_all_workloads!(&mut group, bench_lookup_missing, false);
    group.finish();
}

fn map_iter(c: &mut Criterion) {
    let mut group = benchmark_group(c, "map_iter");
    bench_all_workloads!(&mut group, bench_iter, true);
    group.finish();
}

fn map_churn(c: &mut Criterion) {
    let mut group = benchmark_group(c, "map_churn");
    bench_all_workloads!(&mut group, bench_churn, false);
    group.finish();
}

fn benchmark_group<'a>(c: &'a mut Criterion, name: &'static str) -> BenchGroup<'a> {
    let mut group = c.benchmark_group(name);
    group.plot_config(PlotConfiguration::default().summary_scale(AxisScale::Logarithmic));
    group
}

fn workload_u64(count: usize) -> Workload<u64> {
    let mut entries: Vec<_> = (0..count)
        .map(|index| {
            let key = existing_id(index);
            (key, key)
        })
        .collect();
    let mut hit_keys: Vec<_> = entries.iter().map(|&(key, _)| key).collect();
    let mut missing_keys: Vec<_> = (0..count).map(missing_id).collect();
    let mut replacements: Vec<_> = (0..count)
        .map(|index| {
            let key = replacement_id(index);
            (key, key)
        })
        .collect();

    shuffle(&mut entries, SEED ^ count as u64 ^ 0x100);
    shuffle(&mut hit_keys, SEED ^ count as u64 ^ 0x200);
    shuffle(&mut missing_keys, SEED ^ count as u64 ^ 0x300);
    shuffle(&mut replacements, SEED ^ count as u64 ^ 0x400);

    Workload {
        label: "u64",
        entries,
        hit_keys,
        missing_keys,
        replacements,
    }
}

fn workload_bytes<const N: usize>(count: usize, label: &'static str) -> Workload<[u8; N]> {
    let mut entries: Vec<_> = (0..count)
        .map(|index| {
            let key = byte_key(existing_id(index));
            (key, existing_id(index))
        })
        .collect();
    let mut hit_keys: Vec<_> = entries.iter().map(|&(key, _)| key).collect();
    let mut missing_keys: Vec<_> = (0..count)
        .map(|index| byte_key(missing_id(index)))
        .collect();
    let mut replacements: Vec<_> = (0..count)
        .map(|index| {
            let id = replacement_id(index);
            (byte_key(id), id)
        })
        .collect();

    shuffle(&mut entries, SEED ^ count as u64 ^ N as u64 ^ 0x500);
    shuffle(&mut hit_keys, SEED ^ count as u64 ^ N as u64 ^ 0x600);
    shuffle(&mut missing_keys, SEED ^ count as u64 ^ N as u64 ^ 0x700);
    shuffle(&mut replacements, SEED ^ count as u64 ^ N as u64 ^ 0x800);

    Workload {
        label,
        entries,
        hit_keys,
        missing_keys,
        replacements,
    }
}

fn existing_id(index: usize) -> u64 {
    (index as u64) * 2
}

fn missing_id(index: usize) -> u64 {
    (index as u64) * 2 + 1
}

fn replacement_id(index: usize) -> u64 {
    missing_id(index)
}

fn byte_key<const N: usize>(id: u64) -> [u8; N] {
    let mut key = [0u8; N];
    let mut state = id ^ 0x9e37_79b9_7f4a_7c15;
    let mut offset = 0usize;
    while offset < N {
        state = splitmix64(state);
        let bytes = state.to_le_bytes();
        let len = (N - offset).min(bytes.len());
        key[offset..offset + len].copy_from_slice(&bytes[..len]);
        offset += len;
    }
    key
}

fn splitmix64(mut value: u64) -> u64 {
    value = value.wrapping_add(0x9e37_79b9_7f4a_7c15);
    value = (value ^ (value >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    value = (value ^ (value >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    value ^ (value >> 31)
}

fn shuffle<T>(items: &mut [T], seed: u64) {
    let mut rng = SmallRng::seed_from_u64(seed);
    for index in (1..items.len()).rev() {
        let other = rng.random_range(0..=index);
        items.swap(index, other);
    }
}

fn criterion_config() -> Criterion {
    Criterion::default()
}

criterion_group! {
    name = benches;
    config = criterion_config();
    targets = map_insert_batch, map_remove_batch, map_lookup_hit, map_lookup_missing, map_iter, map_churn
}
criterion_main!(benches);
