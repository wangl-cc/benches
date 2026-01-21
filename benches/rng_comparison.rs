use divan::Bencher;
use rand::{Rng, RngCore, SeedableRng};

fn main() {
    divan::main();
}

#[divan::bench_group(sample_count = 10000)]
mod u64_generation {
    use super::*;

    #[divan::bench]
    fn small_rng(bencher: Bencher) {
        bencher
            .with_inputs(|| rand::rngs::SmallRng::seed_from_u64(42))
            .bench_local_refs(|rng| rng.random::<u64>())
    }

    #[divan::bench]
    fn pcg64(bencher: Bencher) {
        bencher
            .with_inputs(|| rand_pcg::Pcg64::seed_from_u64(42))
            .bench_local_refs(|rng| rng.random::<u64>())
    }

    #[divan::bench]
    fn pcg64mcg(bencher: Bencher) {
        bencher
            .with_inputs(|| rand_pcg::Pcg64Mcg::seed_from_u64(42))
            .bench_local_refs(|rng| rng.random::<u64>())
    }

    #[divan::bench]
    fn pcg64dxsm(bencher: Bencher) {
        bencher
            .with_inputs(|| rand_pcg::Pcg64Dxsm::seed_from_u64(42))
            .bench_local_refs(|rng| rng.random::<u64>())
    }

    #[divan::bench]
    fn xoshiro256plusplus(bencher: Bencher) {
        bencher
            .with_inputs(|| rand_xoshiro::Xoshiro256PlusPlus::seed_from_u64(42))
            .bench_local_refs(|rng| rng.random::<u64>())
    }

    #[divan::bench]
    fn xoshiro256starstar(bencher: Bencher) {
        bencher
            .with_inputs(|| rand_xoshiro::Xoshiro256StarStar::seed_from_u64(42))
            .bench_local_refs(|rng| rng.random::<u64>())
    }
}

#[divan::bench_group(sample_count = 100)]
mod bytes_generation {
    use super::*;

    /// Buffer sizes to test (from 64B to 1MB)
    const SIZES: &[usize] = &[
        1 << 6,  // 64 B
        1 << 10, // 1 KB
        1 << 14, // 16 KB
        1 << 18, // 256 KB
        1 << 20, // 1 MB
    ];

    #[divan::bench(args = SIZES)]
    fn small_rng(bencher: Bencher, size: usize) {
        bencher
            .with_inputs(|| (rand::rngs::SmallRng::seed_from_u64(42), vec![0u8; size]))
            .bench_local_values(|(mut rng, mut buf)| {
                rng.fill_bytes(&mut buf);
                buf
            })
    }

    #[divan::bench(args = SIZES)]
    fn pcg64(bencher: Bencher, size: usize) {
        bencher
            .with_inputs(|| (rand_pcg::Pcg64::seed_from_u64(42), vec![0u8; size]))
            .bench_local_values(|(mut rng, mut buf)| {
                rng.fill_bytes(&mut buf);
                buf
            })
    }

    #[divan::bench(args = SIZES)]
    fn pcg64mcg(bencher: Bencher, size: usize) {
        bencher
            .with_inputs(|| (rand_pcg::Pcg64Mcg::seed_from_u64(42), vec![0u8; size]))
            .bench_local_values(|(mut rng, mut buf)| {
                rng.fill_bytes(&mut buf);
                buf
            })
    }

    #[divan::bench(args = SIZES)]
    fn pcg64dxsm(bencher: Bencher, size: usize) {
        bencher
            .with_inputs(|| (rand_pcg::Pcg64Dxsm::seed_from_u64(42), vec![0u8; size]))
            .bench_local_values(|(mut rng, mut buf)| {
                rng.fill_bytes(&mut buf);
                buf
            })
    }

    #[divan::bench(args = SIZES)]
    fn xoshiro256plusplus(bencher: Bencher, size: usize) {
        bencher
            .with_inputs(|| {
                (
                    rand_xoshiro::Xoshiro256PlusPlus::seed_from_u64(42),
                    vec![0u8; size],
                )
            })
            .bench_local_values(|(mut rng, mut buf)| {
                rng.fill_bytes(&mut buf);
                buf
            })
    }

    #[divan::bench(args = SIZES)]
    fn xoshiro256starstar(bencher: Bencher, size: usize) {
        bencher
            .with_inputs(|| {
                (
                    rand_xoshiro::Xoshiro256StarStar::seed_from_u64(42),
                    vec![0u8; size],
                )
            })
            .bench_local_values(|(mut rng, mut buf)| {
                rng.fill_bytes(&mut buf);
                buf
            })
    }
}
