use blake3::Hasher as Blake3Hasher;
use divan::Bencher;
use rand::{Rng, SeedableRng, rngs::SmallRng};
use sha2::Digest;

fn main() {
    divan::main();
}

/// Data sizes to test (from 16B to 8MB)
const SIZES: &[usize] = &[
    1 << 4,  // 16 B
    1 << 8,  // 256 B
    1 << 12, // 4 KB
    1 << 16, // 64 KB
    1 << 20, // 1 MB
    1 << 24, // 8 MB
];

/// Generate random data for benchmarking
fn generate_data(size: usize) -> Vec<u8> {
    let mut rng = SmallRng::seed_from_u64(42);
    (0..size).map(|_| rng.random()).collect()
}

#[divan::bench_group(sample_count = 100)]
mod hash_comparison {
    use super::*;

    #[divan::bench(args = SIZES)]
    fn sha256(bencher: Bencher, size: usize) {
        bencher
            .with_inputs(|| generate_data(size))
            .bench_local_values(|data| {
                let mut hasher = sha2::Sha256::new();
                hasher.update(&data);
                hasher.finalize()
            })
    }

    #[divan::bench(args = SIZES)]
    fn sha512(bencher: Bencher, size: usize) {
        bencher
            .with_inputs(|| generate_data(size))
            .bench_local_values(|data| {
                let mut hasher = sha2::Sha512::new();
                hasher.update(&data);
                hasher.finalize()
            })
    }

    #[divan::bench(args = SIZES)]
    fn blake3(bencher: Bencher, size: usize) {
        bencher
            .with_inputs(|| generate_data(size))
            .bench_local_values(|data| {
                let mut hasher = Blake3Hasher::new();
                hasher.update(&data);
                hasher.finalize()
            })
    }
}
