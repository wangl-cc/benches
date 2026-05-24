use std::hint::black_box;

use harness::{BenchmarkGroup, BenchmarkProfile, BenchmarkTarget, WorkloadSize};

const INPUT_SEED: u64 = 0x4d53_4141_5f42_454e;
const QUICK_BYTE_SIZES: &[u64] = &[16, 64, 256, 1024, 4096, 65_536];
const PUBLISH_BYTE_SIZES: &[u64] = &[16, 64, 256, 1024, 4096, 16_384, 65_536, 1 << 20];

pub fn hash<D: digest::Digest>(data: &[u8]) -> digest::Output<D> {
    let mut hasher = D::new();
    hasher.update(data);
    hasher.finalize()
}

pub fn benchmark(_profile: BenchmarkProfile) -> BenchmarkTarget {
    BenchmarkTarget::new("Hash")
        .group(hash_group(
            "Non-cryptographic Hash",
            "Hashes deterministic byte buffers with non-cryptographic hash functions.",
            [
                HashAlgorithm::Xor64,
                HashAlgorithm::Xor128,
                HashAlgorithm::RapidHash64,
                HashAlgorithm::Xxh364,
                HashAlgorithm::Xxh3128,
                HashAlgorithm::GxHash64,
                HashAlgorithm::GxHash128,
            ],
        ))
        .group(hash_group(
            "Cryptographic Hash",
            "Hashes deterministic byte buffers with cryptographic hash functions.",
            [
                HashAlgorithm::Sha256,
                HashAlgorithm::Sha512,
                HashAlgorithm::Blake3,
                HashAlgorithm::Blake2b512,
            ],
        ))
}

fn hash_group<const N: usize>(
    name: &'static str,
    description: &'static str,
    algorithms: [HashAlgorithm; N],
) -> BenchmarkGroup {
    let mut builder = BenchmarkGroup::new(name)
        .description(description)
        .workload_axis("Message size", "bytes")
        .quick_sizes(QUICK_BYTE_SIZES.iter().copied())
        .publish_sizes(PUBLISH_BYTE_SIZES.iter().copied())
        .prepare(|size: WorkloadSize| {
            let amount = size.amount() as usize;
            deterministic_bytes(amount, INPUT_SEED ^ size.amount())
        });

    for algorithm in algorithms {
        builder = builder.case(algorithm.name(), algorithm.color(), move |input| {
            algorithm.run(input)
        });
    }

    builder.build()
}

#[derive(Debug, Clone, Copy)]
enum HashAlgorithm {
    Xor64,
    Xor128,
    RapidHash64,
    Xxh364,
    Xxh3128,
    GxHash64,
    GxHash128,
    Sha256,
    Sha512,
    Blake3,
    Blake2b512,
}

impl HashAlgorithm {
    fn name(self) -> &'static str {
        match self {
            Self::Xor64 => "XOR-64-ILP",
            Self::Xor128 => "XOR-128-SIMD",
            Self::RapidHash64 => "RAPIDHASH-64",
            Self::Xxh364 => "XXH3-64",
            Self::Xxh3128 => "XXH3-128",
            Self::GxHash64 => "GXHASH-64",
            Self::GxHash128 => "GXHASH-128",
            Self::Sha256 => "SHA2-256",
            Self::Sha512 => "SHA2-512",
            Self::Blake3 => "BLAKE3-256",
            Self::Blake2b512 => "BLAKE2B-512",
        }
    }

    fn color(self) -> &'static str {
        match self {
            Self::Blake3 => "#0f766e",
            Self::Blake2b512 => "#14b8a6",
            Self::Sha256 => "#ea580c",
            Self::Sha512 => "#f59e0b",
            Self::Xxh364 => "#0891b2",
            Self::Xxh3128 => "#06b6d4",
            Self::RapidHash64 => "#db2777",
            Self::GxHash64 => "#7c3aed",
            Self::GxHash128 => "#a855f7",
            Self::Xor64 => "#64748b",
            Self::Xor128 => "#94a3b8",
        }
    }

    fn run(self, input: &[u8]) -> u128 {
        let value = match self {
            Self::Xor64 => xor_hash64(input) as u128,
            Self::Xor128 => xor_hash128(input),
            Self::RapidHash64 => rapidhash::v3::rapidhash_v3(input) as u128,
            Self::Xxh364 => xxhash_rust::xxh3::xxh3_64(input) as u128,
            Self::Xxh3128 => xxhash_rust::xxh3::xxh3_128(input),
            Self::GxHash64 => gxhash::gxhash64(input, 0) as u128,
            Self::GxHash128 => gxhash::gxhash128(input, 0),
            Self::Sha256 => checksum_bytes(&hash::<sha2::Sha256>(input)),
            Self::Sha512 => checksum_bytes(&hash::<sha2::Sha512>(input)),
            Self::Blake3 => checksum_bytes(blake3::hash(input).as_bytes()),
            Self::Blake2b512 => checksum_bytes(&hash::<blake2::Blake2b512>(input)),
        };
        black_box(value)
    }
}

fn deterministic_bytes(size: usize, seed: u64) -> Vec<u8> {
    let mut state = seed;
    let mut out = Vec::with_capacity(size);
    while out.len() < size {
        let next = splitmix64(&mut state).to_le_bytes();
        let remaining = size - out.len();
        out.extend_from_slice(&next[..remaining.min(next.len())]);
    }
    out
}

fn splitmix64(state: &mut u64) -> u64 {
    *state = state.wrapping_add(0x9e37_79b9_7f4a_7c15);
    let mut z = *state;
    z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    z ^ (z >> 31)
}

fn checksum_bytes(bytes: &[u8]) -> u128 {
    let mut lo = 0xcbf2_9ce4_8422_2325u64;
    let mut hi = 0x8422_2325_cbf2_9ce4u64;
    for &byte in bytes {
        lo ^= u64::from(byte);
        lo = lo.wrapping_mul(0x0000_0100_0000_01b3);
        hi ^= u64::from(byte.rotate_left(1));
        hi = hi.wrapping_mul(0x0000_0100_0000_01b3);
    }
    ((hi as u128) << 64) | lo as u128
}

/// Extremely simple 64-bit XOR fold hash.
///
/// This is intended as a lightweight upper-bound style baseline for throughput experiments.
pub fn xor_hash64(data: &[u8]) -> u64 {
    use std::ptr;

    let mut i = 0usize;
    let len = data.len();
    let mut acc0 = 0u64;
    let mut acc1 = 0u64;
    let mut acc2 = 0u64;
    let mut acc3 = 0u64;

    // SAFETY: all unaligned reads are guarded by explicit bounds checks.
    unsafe {
        while i + 32 <= len {
            let p = data.as_ptr().add(i);
            acc0 ^= u64::from_le(ptr::read_unaligned(p as *const u64));
            acc1 ^= u64::from_le(ptr::read_unaligned(p.add(8) as *const u64));
            acc2 ^= u64::from_le(ptr::read_unaligned(p.add(16) as *const u64));
            acc3 ^= u64::from_le(ptr::read_unaligned(p.add(24) as *const u64));
            i += 32;
        }
    }

    let mut acc = acc0 ^ acc1 ^ acc2 ^ acc3;

    // SAFETY: bounds-checked before each unaligned 8-byte read.
    unsafe {
        while i + 8 <= len {
            acc ^= u64::from_le(ptr::read_unaligned(data.as_ptr().add(i) as *const u64));
            i += 8;
        }
    }

    if i < len {
        let mut tail = [0u8; 8];
        tail[..(len - i)].copy_from_slice(&data[i..]);
        acc ^= u64::from_le_bytes(tail);
    }

    acc
}

/// 128-bit XOR fold hash optimized as a throughput baseline.
///
/// Uses SIMD XOR with multiple independent accumulators on modern x86_64/aarch64 targets.
pub fn xor_hash128(data: &[u8]) -> u128 {
    // Use AVX2 when available on this build target.
    #[cfg(all(target_arch = "x86_64", target_feature = "avx2"))]
    return xor_hash128_avx2(data);

    // SSE2 is baseline on x86_64.
    #[cfg(all(target_arch = "x86_64", not(target_feature = "avx2")))]
    return xor_hash128_sse2(data);

    // NEON is baseline on aarch64.
    #[cfg(target_arch = "aarch64")]
    return xor_hash128_neon(data);

    #[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64")))]
    compile_error!("xor_hash128 requires SIMD support on x86_64 or aarch64");
}

#[cfg(all(target_arch = "x86_64", target_feature = "avx2"))]
pub fn xor_hash128_avx2(data: &[u8]) -> u128 {
    use std::arch::x86_64::{
        __m128i, __m256i, _mm_loadu_si128, _mm_storeu_si128, _mm_xor_si128, _mm256_castsi256_si128,
        _mm256_extracti128_si256, _mm256_loadu_si256, _mm256_setzero_si256, _mm256_xor_si256,
    };

    let mut i = 0usize;
    let mut out = [0u8; 16];

    // SAFETY: all pointer reads/writes are in-bounds for the checked ranges.
    unsafe {
        // Four independent accumulators reduce dependency chains and improve ILP.
        let mut acc0: __m256i = _mm256_setzero_si256();
        let mut acc1: __m256i = _mm256_setzero_si256();
        let mut acc2: __m256i = _mm256_setzero_si256();
        let mut acc3: __m256i = _mm256_setzero_si256();

        while i + 128 <= data.len() {
            let b0 = _mm256_loadu_si256(data.as_ptr().add(i) as *const __m256i);
            let b1 = _mm256_loadu_si256(data.as_ptr().add(i + 32) as *const __m256i);
            let b2 = _mm256_loadu_si256(data.as_ptr().add(i + 64) as *const __m256i);
            let b3 = _mm256_loadu_si256(data.as_ptr().add(i + 96) as *const __m256i);
            acc0 = _mm256_xor_si256(acc0, b0);
            acc1 = _mm256_xor_si256(acc1, b1);
            acc2 = _mm256_xor_si256(acc2, b2);
            acc3 = _mm256_xor_si256(acc3, b3);
            i += 128;
        }

        let mut acc = _mm256_xor_si256(_mm256_xor_si256(acc0, acc1), _mm256_xor_si256(acc2, acc3));
        while i + 32 <= data.len() {
            let block = _mm256_loadu_si256(data.as_ptr().add(i) as *const __m256i);
            acc = _mm256_xor_si256(acc, block);
            i += 32;
        }

        let lo = _mm256_castsi256_si128(acc);
        let hi = _mm256_extracti128_si256(acc, 1);
        let mut acc128 = _mm_xor_si128(lo, hi);
        while i + 16 <= data.len() {
            let block = _mm_loadu_si128(data.as_ptr().add(i) as *const __m128i);
            acc128 = _mm_xor_si128(acc128, block);
            i += 16;
        }
        _mm_storeu_si128(out.as_mut_ptr() as *mut __m128i, acc128);
    }

    if i < data.len() {
        for (idx, b) in data[i..].iter().enumerate() {
            out[idx] ^= *b;
        }
    }

    u128::from_le_bytes(out)
}

#[cfg(target_arch = "x86_64")]
pub fn xor_hash128_sse2(data: &[u8]) -> u128 {
    use std::arch::x86_64::{
        __m128i, _mm_loadu_si128, _mm_setzero_si128, _mm_storeu_si128, _mm_xor_si128,
    };

    let mut i = 0usize;
    let mut out = [0u8; 16];

    // SAFETY: all pointer reads/writes are in-bounds for the checked ranges.
    unsafe {
        // Four independent accumulators reduce dependency chains and improve ILP.
        let mut acc0 = _mm_setzero_si128();
        let mut acc1 = _mm_setzero_si128();
        let mut acc2 = _mm_setzero_si128();
        let mut acc3 = _mm_setzero_si128();

        while i + 64 <= data.len() {
            let b0 = _mm_loadu_si128(data.as_ptr().add(i) as *const __m128i);
            let b1 = _mm_loadu_si128(data.as_ptr().add(i + 16) as *const __m128i);
            let b2 = _mm_loadu_si128(data.as_ptr().add(i + 32) as *const __m128i);
            let b3 = _mm_loadu_si128(data.as_ptr().add(i + 48) as *const __m128i);
            acc0 = _mm_xor_si128(acc0, b0);
            acc1 = _mm_xor_si128(acc1, b1);
            acc2 = _mm_xor_si128(acc2, b2);
            acc3 = _mm_xor_si128(acc3, b3);
            i += 64;
        }

        let mut acc = _mm_xor_si128(_mm_xor_si128(acc0, acc1), _mm_xor_si128(acc2, acc3));
        while i + 16 <= data.len() {
            let block = _mm_loadu_si128(data.as_ptr().add(i) as *const __m128i);
            acc = _mm_xor_si128(acc, block);
            i += 16;
        }
        _mm_storeu_si128(out.as_mut_ptr() as *mut __m128i, acc);
    }

    if i < data.len() {
        for (idx, b) in data[i..].iter().enumerate() {
            out[idx] ^= *b;
        }
    }

    u128::from_le_bytes(out)
}

#[cfg(target_arch = "aarch64")]
pub fn xor_hash128_neon(data: &[u8]) -> u128 {
    use std::arch::aarch64::{uint8x16_t, vdupq_n_u8, veorq_u8, vld1q_u8, vst1q_u8};

    let mut i = 0usize;
    let mut out = [0u8; 16];

    // SAFETY: all pointer reads/writes are in-bounds for the checked ranges.
    unsafe {
        // Four independent accumulators reduce dependency chains and improve ILP.
        let mut acc0: uint8x16_t = vdupq_n_u8(0);
        let mut acc1: uint8x16_t = vdupq_n_u8(0);
        let mut acc2: uint8x16_t = vdupq_n_u8(0);
        let mut acc3: uint8x16_t = vdupq_n_u8(0);

        while i + 64 <= data.len() {
            let b0 = vld1q_u8(data.as_ptr().add(i));
            let b1 = vld1q_u8(data.as_ptr().add(i + 16));
            let b2 = vld1q_u8(data.as_ptr().add(i + 32));
            let b3 = vld1q_u8(data.as_ptr().add(i + 48));
            acc0 = veorq_u8(acc0, b0);
            acc1 = veorq_u8(acc1, b1);
            acc2 = veorq_u8(acc2, b2);
            acc3 = veorq_u8(acc3, b3);
            i += 64;
        }

        let mut acc = veorq_u8(veorq_u8(acc0, acc1), veorq_u8(acc2, acc3));
        while i + 16 <= data.len() {
            let block = vld1q_u8(data.as_ptr().add(i));
            acc = veorq_u8(acc, block);
            i += 16;
        }
        vst1q_u8(out.as_mut_ptr(), acc);
    }

    if i < data.len() {
        for (idx, b) in data[i..].iter().enumerate() {
            out[idx] ^= *b;
        }
    }

    u128::from_le_bytes(out)
}
