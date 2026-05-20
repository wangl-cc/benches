use std::{
    fmt,
    path::{Path, PathBuf},
};

#[derive(Debug, Clone, Copy)]
pub struct ChartSpec {
    pub title: &'static str,
    pub src_path: &'static str,
    pub dest_path: &'static str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Scope {
    Hash,
    Map,
    Prng,
}

impl Scope {
    pub fn all() -> &'static [Scope] {
        &[Scope::Hash, Scope::Map, Scope::Prng]
    }

    pub fn slug(self) -> &'static str {
        match self {
            Scope::Hash => "hash",
            Scope::Map => "map",
            Scope::Prng => "prng",
        }
    }

    pub fn bench_crate(self) -> &'static str {
        match self {
            Scope::Hash => "bench_hash",
            Scope::Map => "bench_map",
            Scope::Prng => "bench_prng",
        }
    }

    pub fn bench_file(self) -> &'static str {
        match self {
            Scope::Hash => "hash_comparison",
            Scope::Map => "map_comparison",
            Scope::Prng => "rng_comparison",
        }
    }

    pub fn charts(self) -> &'static [ChartSpec] {
        match self {
            Scope::Hash => &[
                ChartSpec {
                    title: "Non-Cryptographic Hash Throughput",
                    src_path: "target/criterion/non_cryptographic_hash/report/lines_throughput.svg",
                    dest_path: "non_cryptographic_hash_lines_throughput.svg",
                },
                ChartSpec {
                    title: "Cryptographic Hash Throughput",
                    src_path: "target/criterion/cryptographic_hash/report/lines_throughput.svg",
                    dest_path: "cryptographic_hash_lines_throughput.svg",
                },
            ],
            Scope::Map => &[
                ChartSpec {
                    title: "Map Batch Insert Throughput",
                    src_path: "target/criterion/map_insert_batch/report/lines_throughput.svg",
                    dest_path: "map_insert_batch_lines_throughput.svg",
                },
                ChartSpec {
                    title: "Map Batch Remove Throughput",
                    src_path: "target/criterion/map_remove_batch/report/lines_throughput.svg",
                    dest_path: "map_remove_batch_lines_throughput.svg",
                },
                ChartSpec {
                    title: "Map Lookup Hit Throughput",
                    src_path: "target/criterion/map_lookup_hit/report/lines_throughput.svg",
                    dest_path: "map_lookup_hit_lines_throughput.svg",
                },
                ChartSpec {
                    title: "Map Lookup Missing Throughput",
                    src_path: "target/criterion/map_lookup_missing/report/lines_throughput.svg",
                    dest_path: "map_lookup_missing_lines_throughput.svg",
                },
                ChartSpec {
                    title: "Map Iteration Throughput",
                    src_path: "target/criterion/map_iter/report/lines_throughput.svg",
                    dest_path: "map_iter_lines_throughput.svg",
                },
                ChartSpec {
                    title: "Map Steady-State Churn Throughput",
                    src_path: "target/criterion/map_churn/report/lines_throughput.svg",
                    dest_path: "map_churn_lines_throughput.svg",
                },
            ],
            Scope::Prng => &[
                ChartSpec {
                    src_path: "target/criterion/u64_generation/report/lines_throughput.svg",
                    dest_path: "u64_generation_lines_throughput.svg",
                    title: "u64 Generation Throughput",
                },
                ChartSpec {
                    src_path: "target/criterion/bytes_generation/report/lines_throughput.svg",
                    dest_path: "bytes_generation_lines_throughput.svg",
                    title: "Bytes Generation Throughput",
                },
            ],
        }
    }

    pub fn crate_results_readme(self, workspace_root: &Path) -> PathBuf {
        workspace_root.join(self.bench_crate()).join("RESULTS.md")
    }
}

impl fmt::Display for Scope {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.slug())
    }
}
