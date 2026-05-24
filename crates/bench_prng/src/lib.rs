use std::hint::black_box;

use harness::{BenchmarkGroup, BenchmarkProfile, BenchmarkTarget, WorkloadSize};
use rand::{RngCore, SeedableRng};

const PRNG_SEED: u64 = 42;
const QUICK_BYTE_SIZES: &[u64] = &[16, 64, 256, 1024, 4096, 65_536];
const PUBLISH_BYTE_SIZES: &[u64] = &[16, 64, 256, 1024, 4096, 16_384, 65_536, 1 << 20];
const QUICK_U64_COUNTS: &[u64] = &[1, 64, 1024];
const PUBLISH_U64_COUNTS: &[u64] = &[1, 4, 16, 64, 256, 1024, 4096, 16_384];

pub fn benchmark(_profile: BenchmarkProfile) -> BenchmarkTarget {
    BenchmarkTarget::new("PRNG")
        .group(u64_generation_group())
        .group(bytes_generation_group())
}

fn u64_generation_group() -> BenchmarkGroup {
    let mut builder = BenchmarkGroup::new("u64 Generation")
        .description("Generates fixed-size batches of u64 values from each PRNG implementation.")
        .workload_axis("Batch length", "elements")
        .quick_sizes(QUICK_U64_COUNTS.iter().copied())
        .publish_sizes(PUBLISH_U64_COUNTS.iter().copied())
        .prepare(|size: WorkloadSize| U64Workload {
            count: size.amount() as usize,
        });

    for algorithm in PrngAlgorithm::ALL {
        builder = builder.case(algorithm.name(), algorithm.color(), move |workload| {
            let mut rng = RngImpl::new(algorithm, PRNG_SEED);
            let mut acc = 0u64;
            for _ in 0..workload.count {
                acc ^= rng.next_u64();
            }
            black_box(acc as u128)
        });
    }

    builder.build()
}

fn bytes_generation_group() -> BenchmarkGroup {
    let mut builder = BenchmarkGroup::new("Bytes Generation")
        .description("Fills fixed-size byte buffers from each PRNG implementation.")
        .workload_axis("Buffer size", "bytes")
        .quick_sizes(QUICK_BYTE_SIZES.iter().copied())
        .publish_sizes(PUBLISH_BYTE_SIZES.iter().copied())
        .prepare(|size: WorkloadSize| BytesWorkload {
            buf: vec![0; size.amount() as usize],
        });

    for algorithm in PrngAlgorithm::ALL {
        builder = builder.case(algorithm.name(), algorithm.color(), move |workload| {
            let mut rng = RngImpl::new(algorithm, PRNG_SEED);
            rng.fill_bytes(&mut workload.buf);
            black_box(workload.buf.as_slice());
            cheap_buffer_fingerprint(&workload.buf)
        });
    }

    builder.build()
}

struct U64Workload {
    count: usize,
}

struct BytesWorkload {
    buf: Vec<u8>,
}

#[derive(Debug, Clone, Copy)]
enum PrngAlgorithm {
    Pcg64,
    Pcg64Mcg,
    Pcg64Dxsm,
    Xoshiro256PlusPlus,
    Xoshiro256StarStar,
}

impl PrngAlgorithm {
    const ALL: [Self; 5] = [
        Self::Pcg64,
        Self::Pcg64Mcg,
        Self::Pcg64Dxsm,
        Self::Xoshiro256PlusPlus,
        Self::Xoshiro256StarStar,
    ];

    fn name(self) -> &'static str {
        match self {
            Self::Pcg64 => "PCG64",
            Self::Pcg64Mcg => "PCG64-MCG",
            Self::Pcg64Dxsm => "PCG64DXSM",
            Self::Xoshiro256PlusPlus => "xoshiro256++",
            Self::Xoshiro256StarStar => "xoshiro256**",
        }
    }

    fn color(self) -> &'static str {
        match self {
            Self::Pcg64 => "#1d4ed8",
            Self::Pcg64Mcg => "#3b82f6",
            Self::Pcg64Dxsm => "#60a5fa",
            Self::Xoshiro256PlusPlus => "#be123c",
            Self::Xoshiro256StarStar => "#f43f5e",
        }
    }
}

fn cheap_buffer_fingerprint(bytes: &[u8]) -> u128 {
    let first = bytes.first().copied().unwrap_or_default() as u128;
    let middle = bytes.get(bytes.len() / 2).copied().unwrap_or_default() as u128;
    let last = bytes.last().copied().unwrap_or_default() as u128;
    first | (middle << 8) | (last << 16) | ((bytes.len() as u128) << 24)
}

enum RngImpl {
    Pcg64(rand_pcg::Pcg64),
    Pcg64Mcg(rand_pcg::Pcg64Mcg),
    Pcg64Dxsm(rand_pcg::Pcg64Dxsm),
    Xoshiro256PlusPlus(rand_xoshiro::Xoshiro256PlusPlus),
    Xoshiro256StarStar(rand_xoshiro::Xoshiro256StarStar),
}

impl RngImpl {
    fn new(algorithm: PrngAlgorithm, seed: u64) -> Self {
        match algorithm {
            PrngAlgorithm::Pcg64 => Self::Pcg64(rand_pcg::Pcg64::seed_from_u64(seed)),
            PrngAlgorithm::Pcg64Mcg => Self::Pcg64Mcg(rand_pcg::Pcg64Mcg::seed_from_u64(seed)),
            PrngAlgorithm::Pcg64Dxsm => Self::Pcg64Dxsm(rand_pcg::Pcg64Dxsm::seed_from_u64(seed)),
            PrngAlgorithm::Xoshiro256PlusPlus => {
                Self::Xoshiro256PlusPlus(rand_xoshiro::Xoshiro256PlusPlus::seed_from_u64(seed))
            }
            PrngAlgorithm::Xoshiro256StarStar => {
                Self::Xoshiro256StarStar(rand_xoshiro::Xoshiro256StarStar::seed_from_u64(seed))
            }
        }
    }
}

impl RngCore for RngImpl {
    fn next_u32(&mut self) -> u32 {
        match self {
            Self::Pcg64(rng) => rng.next_u32(),
            Self::Pcg64Mcg(rng) => rng.next_u32(),
            Self::Pcg64Dxsm(rng) => rng.next_u32(),
            Self::Xoshiro256PlusPlus(rng) => rng.next_u32(),
            Self::Xoshiro256StarStar(rng) => rng.next_u32(),
        }
    }

    fn next_u64(&mut self) -> u64 {
        match self {
            Self::Pcg64(rng) => rng.next_u64(),
            Self::Pcg64Mcg(rng) => rng.next_u64(),
            Self::Pcg64Dxsm(rng) => rng.next_u64(),
            Self::Xoshiro256PlusPlus(rng) => rng.next_u64(),
            Self::Xoshiro256StarStar(rng) => rng.next_u64(),
        }
    }

    fn fill_bytes(&mut self, dest: &mut [u8]) {
        match self {
            Self::Pcg64(rng) => rng.fill_bytes(dest),
            Self::Pcg64Mcg(rng) => rng.fill_bytes(dest),
            Self::Pcg64Dxsm(rng) => rng.fill_bytes(dest),
            Self::Xoshiro256PlusPlus(rng) => rng.fill_bytes(dest),
            Self::Xoshiro256StarStar(rng) => rng.fill_bytes(dest),
        }
    }
}
