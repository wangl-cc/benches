use clap::{Args, Parser, ValueEnum};

use crate::scope::Scope;

#[derive(Debug, Parser)]
#[command(name = "xtask", about = "Workspace helper commands")]
pub enum Command {
    /// Run benchmarks
    Run(RunOpts),

    /// Collect benchmark charts and write readme for current host
    Collect(CollectOpts),

    /// Aggregate results from all hosts
    Aggregate,
}

#[derive(Debug, Clone, Args)]
pub struct BenchOpts {
    /// Whether to run benchmarks quickly (decreases runtime)
    #[arg(long)]
    pub quick: bool,

    /// Extra arguments to pass to `cargo bench`
    #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
    pub bench_extra_args: Vec<String>,
}

#[derive(Debug, Clone, Args)]
pub struct RunOpts {
    /// Benchmark scope to run
    #[arg(long, value_enum, default_value_t = ScopeValue::All)]
    pub scope: ScopeValue,

    #[command(flatten)]
    pub bench_args: BenchOpts,
}

#[derive(Debug, Clone, Args)]
pub struct CollectOpts {
    /// Whether to run benchmarks before collecting results
    #[arg(short, long)]
    pub run_bench: bool,

    #[command(flatten)]
    pub bench_args: BenchOpts,
}

#[derive(Debug, Clone, Copy, ValueEnum)]
pub enum ScopeValue {
    Hash,
    Map,
    Prng,
    All,
}

impl ScopeValue {
    pub fn to_scopes(self) -> &'static [Scope] {
        match self {
            ScopeValue::All => Scope::all(),
            ScopeValue::Hash => &[Scope::Hash],
            ScopeValue::Map => &[Scope::Map],
            ScopeValue::Prng => &[Scope::Prng],
        }
    }
}
