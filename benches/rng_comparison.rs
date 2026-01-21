use std::hint::black_box;

use divan::Bencher;
use rand::{RngCore, SeedableRng};

fn main() {
    divan::main();
}

#[divan::bench_group(sample_count = 10000)]
mod u64_generation {
    use super::*;

    fn bench(rng: &mut impl RngCore, acc: &mut u64) {
        let x = rng.next_u64();
        *acc ^= x;
        black_box(*acc);
    }

    #[divan::bench]
    fn small_rng(bencher: Bencher) {
        bencher
            .with_inputs(|| (rand::rngs::SmallRng::seed_from_u64(42), 0u64))
            .bench_local_refs(|(rng, acc)| bench(rng, acc))
    }

    #[divan::bench]
    fn pcg64(bencher: Bencher) {
        bencher
            .with_inputs(|| (rand_pcg::Pcg64::seed_from_u64(42), 0u64))
            .bench_local_refs(|(rng, acc)| bench(rng, acc))
    }

    #[divan::bench]
    fn pcg64mcg(bencher: Bencher) {
        bencher
            .with_inputs(|| (rand_pcg::Pcg64Mcg::seed_from_u64(42), 0u64))
            .bench_local_refs(|(rng, acc)| bench(rng, acc))
    }

    #[divan::bench]
    fn pcg64dxsm(bencher: Bencher) {
        bencher
            .with_inputs(|| (rand_pcg::Pcg64Dxsm::seed_from_u64(42), 0u64))
            .bench_local_refs(|(rng, acc)| bench(rng, acc))
    }

    #[divan::bench]
    fn xoshiro256plusplus(bencher: Bencher) {
        bencher
            .with_inputs(|| (rand_xoshiro::Xoshiro256PlusPlus::seed_from_u64(42), 0u64))
            .bench_local_refs(|(rng, acc)| bench(rng, acc))
    }

    #[divan::bench]
    fn xoshiro256starstar(bencher: Bencher) {
        bencher
            .with_inputs(|| (rand_xoshiro::Xoshiro256StarStar::seed_from_u64(42), 0u64))
            .bench_local_refs(|(rng, acc)| bench(rng, acc))
    }
}

#[divan::bench_group(sample_count = 100)]
mod bytes_generation {
    use super::*;

    /// Buffer sizes to fill (from 16B to 1MiB)
    const SIZES: &[usize] = &[
        1 << 4,  // 16 B
        1 << 8,  // 256 B
        1 << 12, // 8 KiB
        1 << 16, // 64 KiB
        1 << 20, // 1 MiB
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
