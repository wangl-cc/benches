use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

use crate::{
    bench,
    cli::{CollectOpts, RunOpts, ScopeValue},
    environment::BenchmarkEnvironment,
    scope::Scope,
    util::{Result, run_capture, workspace_root},
};

pub fn collect_results(args: CollectOpts) -> Result<()> {
    let workspace_root = workspace_root();

    if args.run_bench {
        let run_args = RunOpts {
            scope: ScopeValue::All,
            bench_args: args.bench_args.clone(),
        };
        bench::run_benchmarks(&run_args)?;
    }

    let environment = BenchmarkEnvironment::detect();
    let result_dir = collect_host_results(&args, workspace_root, &environment)?;
    println!("{}", result_dir.display());

    Ok(())
}

fn collect_host_results(
    args: &CollectOpts,
    workspace_root: &Path,
    environment: &BenchmarkEnvironment,
) -> Result<PathBuf> {
    let results_root = workspace_root.join("results");
    fs::create_dir_all(&results_root)?;

    let host_id = environment.result_name();
    let result_dir = results_root.join(&host_id);
    let staging_dir = results_root.join(format!(".{host_id}.tmp"));
    if staging_dir.is_dir() {
        fs::remove_dir_all(&staging_dir)?;
    }

    let charts_dir = staging_dir.join("charts");
    fs::create_dir_all(&charts_dir)?;

    for &scope in Scope::all() {
        bench::ensure_chart_artifacts(scope, workspace_root)?;
        for chart in scope.charts() {
            let src = workspace_root.join(chart.src_path);
            fs::copy(src, charts_dir.join(chart.dest_path))?;
        }
    }

    write_host_readme(&staging_dir, args, environment)?;
    environment.write_metadata_file(&staging_dir)?;
    replace_result_dir(&staging_dir, &result_dir)?;

    Ok(result_dir)
}

fn replace_result_dir(staging_dir: &Path, result_dir: &Path) -> Result<()> {
    if result_dir.exists() {
        fs::remove_dir_all(result_dir)?;
    }
    fs::rename(staging_dir, result_dir)?;
    Ok(())
}

fn write_host_readme(
    result_dir: &Path,
    args: &CollectOpts,
    environment: &BenchmarkEnvironment,
) -> Result<()> {
    let mut file = fs::File::create(result_dir.join("README.md"))?;
    let running_at =
        run_capture("date", &["+%Y-%m-%d %H:%M:%S %z"]).unwrap_or_else(|| "unknown".to_owned());

    writeln!(file, "# Benchmark Results")?;
    writeln!(file)?;
    writeln!(file, "Running at {running_at}.")?;
    writeln!(file)?;
    environment.write_markdown(&mut file)?;
    writeln!(file)?;
    writeln!(file, "## Collect Settings")?;
    writeln!(file)?;
    writeln!(
        file,
        "- Run benchmarks before collect: {}",
        if args.run_bench { "yes" } else { "no" }
    )?;
    writeln!(
        file,
        "- Quick mode: {}",
        if args.bench_args.quick {
            "enabled"
        } else {
            "disabled"
        }
    )?;
    if !args.bench_args.bench_extra_args.is_empty() {
        writeln!(
            file,
            "- Extra cargo bench args: `{}`",
            args.bench_args.bench_extra_args.join(" ")
        )?;
    }

    writeln!(file)?;
    writeln!(file, "## Results")?;

    for &scope in Scope::all() {
        writeln!(file)?;
        writeln!(file, "### {}", scope_title(scope))?;
        for chart in scope.charts() {
            writeln!(file)?;
            writeln!(file, "#### {}", chart.title)?;
            writeln!(file)?;
            writeln!(file, "![{}](charts/{})", chart.title, chart.dest_path)?;
        }
    }

    Ok(())
}

fn scope_title(scope: Scope) -> &'static str {
    match scope {
        Scope::Hash => "Hash",
        Scope::Map => "Map",
        Scope::Prng => "PRNG",
    }
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::{replace_result_dir, write_host_readme};
    use crate::{
        cli::{BenchOpts, CollectOpts},
        environment::BenchmarkEnvironment,
    };

    #[test]
    fn readme_sections_order_and_spacing() {
        let temp = temp_dir("collect-readme");
        fs::create_dir_all(&temp).expect("create temp dir");

        let args = CollectOpts {
            run_bench: false,
            bench_args: BenchOpts {
                quick: true,
                bench_extra_args: vec![],
            },
        };
        let env = BenchmarkEnvironment::detect();
        write_host_readme(&temp, &args, &env).expect("write README");

        let readme = fs::read_to_string(temp.join("README.md")).expect("read README");
        let env_idx = readme.find("## Environment").expect("missing Environment");
        let settings_idx = readme
            .find("## Collect Settings")
            .expect("missing Collect Settings");
        let results_idx = readme.find("## Results").expect("missing Results");
        assert!(env_idx < settings_idx && settings_idx < results_idx);
        assert!(
            readme.contains("#### Non-Cryptographic Hash Throughput\n\n!["),
            "heading should be followed by a blank line"
        );

        fs::remove_dir_all(temp).expect("cleanup");
    }

    #[test]
    fn replace_result_dir_overwrites_old_content() {
        let root = temp_dir("collect-replace");
        let staging = root.join("staging");
        let result = root.join("result");
        fs::create_dir_all(&staging).expect("create staging");
        fs::create_dir_all(&result).expect("create result");
        fs::write(staging.join("new.txt"), "new").expect("write staging");
        fs::write(result.join("old.txt"), "old").expect("write result");

        replace_result_dir(&staging, &result).expect("replace dir");
        assert!(result.join("new.txt").is_file());
        assert!(!result.join("old.txt").exists());
        assert!(!staging.exists());

        fs::remove_dir_all(root).expect("cleanup");
    }

    fn temp_dir(prefix: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be monotonic")
            .as_nanos();
        std::env::temp_dir().join(format!("xtask-{prefix}-{nanos}"))
    }
}
