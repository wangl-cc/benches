use harness::BenchmarkCase;
use rand::{Rng, SeedableRng};

const PRNG_SEED: u64 = 42;

pub struct U64Workload {
    pub count: usize,
}

pub struct BytesWorkload {
    pub buf: Vec<u8>,
}

pub struct U64State<R> {
    rng: R,
    count: usize,
}

pub struct BytesState<R> {
    rng: R,
    buf: Vec<u8>,
}

pub fn observe_buffer(bytes: &[u8]) -> u64 {
    let first = bytes.first().copied().unwrap_or_default() as u64;
    let middle = bytes.get(bytes.len() / 2).copied().unwrap_or_default() as u64;
    let last = bytes.last().copied().unwrap_or_default() as u64;
    first | (middle << 8) | (last << 16) | ((bytes.len() as u64) << 24)
}

pub mod cases {
    use super::*;

    macro_rules! prng_case {
        ($case:ident, $rng:ty, $name:literal, $color:literal) => {
            pub struct $case;

            impl BenchmarkCase<U64Workload> for $case {
                type Output = u64;
                type State = U64State<$rng>;

                fn name(&self) -> &'static str {
                    $name
                }

                fn color(&self) -> &'static str {
                    $color
                }

                fn prepare(&self, workload: U64Workload) -> Self::State {
                    U64State {
                        rng: <$rng>::seed_from_u64(PRNG_SEED),
                        count: workload.count,
                    }
                }

                fn run_once(&self, state: &mut Self::State) -> Self::Output {
                    run_u64_batch(&mut state.rng, state.count)
                }
            }

            impl BenchmarkCase<BytesWorkload> for $case {
                type Output = u64;
                type State = BytesState<$rng>;

                fn name(&self) -> &'static str {
                    $name
                }

                fn color(&self) -> &'static str {
                    $color
                }

                fn prepare(&self, workload: BytesWorkload) -> Self::State {
                    BytesState {
                        rng: <$rng>::seed_from_u64(PRNG_SEED),
                        buf: workload.buf,
                    }
                }

                fn run_once(&self, state: &mut Self::State) -> Self::Output {
                    fill_bytes(&mut state.rng, &mut state.buf)
                }
            }
        };
    }

    prng_case!(Pcg64, rand_pcg::Pcg64, "PCG64", "#1d4ed8");
    prng_case!(Pcg64Mcg, rand_pcg::Pcg64Mcg, "PCG64-MCG", "#3b82f6");
    prng_case!(Pcg64Dxsm, rand_pcg::Pcg64Dxsm, "PCG64DXSM", "#60a5fa");
    prng_case!(
        Xoshiro256PlusPlus,
        rand_xoshiro::Xoshiro256PlusPlus,
        "xoshiro256++",
        "#be123c"
    );
    prng_case!(
        Xoshiro256StarStar,
        rand_xoshiro::Xoshiro256StarStar,
        "xoshiro256**",
        "#f43f5e"
    );
}

fn run_u64_batch<R>(rng: &mut R, count: usize) -> u64
where
    R: Rng,
{
    let mut acc = 0u64;
    for _ in 0..count {
        acc ^= rng.next_u64();
    }
    acc
}

fn fill_bytes<R>(rng: &mut R, buf: &mut [u8]) -> u64
where
    R: Rng,
{
    rng.fill_bytes(buf);
    observe_buffer(buf)
}
