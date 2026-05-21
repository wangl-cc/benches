use std::{fmt::Write as _, fs, io, path::Path};

use serde::Serialize;

use crate::{
    environment::{EnvironmentSummary, read_cpu_from_metadata, read_environment_summary},
    scope::{ChartSpec, Scope},
    util::{Result, workspace_root},
};

pub fn aggregate_results() -> Result<()> {
    let workspace_root = workspace_root();
    for &scope in Scope::all() {
        write_scope_results_markdown(workspace_root, scope)?;
    }
    write_site_results_json(workspace_root)?;
    Ok(())
}

fn write_scope_results_markdown(workspace_root: &Path, scope: Scope) -> Result<()> {
    let path = scope.crate_results_readme(workspace_root);
    let hosts = list_hosts(workspace_root)?;

    let mut content = String::new();
    writeln!(&mut content, "# Benchmark Results")?;

    let mut has_any_chart = false;
    for chart in scope.charts() {
        let matching_hosts = list_hosts_with_chart(workspace_root, &hosts, chart)?;
        if matching_hosts.is_empty() {
            continue;
        }
        has_any_chart = true;

        writeln!(&mut content)?;
        writeln!(&mut content, "## {}", chart.title)?;
        for host in matching_hosts {
            writeln!(&mut content)?;
            writeln!(
                &mut content,
                "### [{}]({})",
                host.title,
                host_readme_markdown_path(&host.id)
            )?;
            writeln!(&mut content)?;
            let alt_text = format!("{} ({})", chart.title, host.title);
            writeln!(
                &mut content,
                "![{}]({})",
                alt_text,
                chart_markdown_path(&host.id, chart.dest_path)
            )?;
        }
    }

    if !has_any_chart {
        writeln!(&mut content)?;
        writeln!(&mut content, "_No results found yet._")?;
    }

    fs::write(path, content)?;
    Ok(())
}

#[derive(Debug, Clone)]
struct HostInfo {
    id: String,
    title: String,
}

#[derive(Debug, Serialize)]
struct SiteResults {
    #[serde(rename = "generatedAt")]
    generated_at: String,
    hosts: Vec<SiteHost>,
    scopes: Vec<SiteScope>,
}

#[derive(Debug, Serialize)]
struct SiteHost {
    id: String,
    title: String,
    environment: SiteEnvironment,
}

#[derive(Debug, Serialize)]
struct SiteEnvironment {
    cpu: String,
    os: String,
    kernel: String,
    rustc: String,
    llvm: String,
}

#[derive(Debug, Serialize)]
struct SiteScope {
    id: &'static str,
    title: &'static str,
    charts: Vec<SiteChart>,
}

#[derive(Debug, Serialize)]
struct SiteChart {
    id: String,
    title: &'static str,
    hosts: Vec<SiteChartHost>,
}

#[derive(Debug, Serialize)]
struct SiteChartHost {
    #[serde(rename = "hostId")]
    host_id: String,
    src: String,
}

fn write_site_results_json(workspace_root: &Path) -> Result<()> {
    let site_public_dir = workspace_root.join("site").join("public");
    fs::create_dir_all(&site_public_dir)?;
    copy_site_chart_assets(workspace_root, &site_public_dir)?;

    let site_results = build_site_results(workspace_root)?;
    let json = serde_json::to_string_pretty(&site_results)?;
    fs::write(site_public_dir.join("results.json"), format!("{json}\n"))?;
    Ok(())
}

fn build_site_results(workspace_root: &Path) -> Result<SiteResults> {
    let hosts = list_hosts(workspace_root)?;
    let site_hosts = hosts
        .iter()
        .map(|host| {
            let result_dir = workspace_root.join("results").join(&host.id);
            SiteHost {
                id: host.id.clone(),
                title: host.title.clone(),
                environment: site_environment(
                    read_environment_summary(&result_dir)
                        .unwrap_or_else(|| fallback_environment(&host.title)),
                ),
            }
        })
        .collect();

    let mut scopes = Vec::new();
    for &scope in Scope::all() {
        let mut charts = Vec::new();
        for chart in scope.charts() {
            let matching_hosts = list_hosts_with_chart(workspace_root, &hosts, chart)?;
            if matching_hosts.is_empty() {
                continue;
            }

            charts.push(SiteChart {
                id: chart_id(chart.dest_path),
                title: chart.title,
                hosts: matching_hosts
                    .into_iter()
                    .map(|host| SiteChartHost {
                        src: site_chart_path(&host.id, chart.dest_path),
                        host_id: host.id,
                    })
                    .collect(),
            });
        }

        scopes.push(SiteScope {
            id: scope.slug(),
            title: scope_title(scope),
            charts,
        });
    }

    Ok(SiteResults {
        generated_at: latest_result_run_at(workspace_root, &hosts)
            .unwrap_or_else(|| "unknown".to_owned()),
        hosts: site_hosts,
        scopes,
    })
}

fn copy_site_chart_assets(workspace_root: &Path, site_public_dir: &Path) -> io::Result<()> {
    let src_root = workspace_root.join("results");
    let dest_root = site_public_dir.join("results");
    if dest_root.exists() {
        fs::remove_dir_all(&dest_root)?;
    }
    if !src_root.is_dir() {
        return Ok(());
    }

    for entry in fs::read_dir(src_root)? {
        let entry = entry?;
        let host_id = entry.file_name().to_string_lossy().into_owned();
        let src_charts_dir = entry.path().join("charts");
        if !src_charts_dir.is_dir() {
            continue;
        }

        let dest_charts_dir = dest_root.join(host_id).join("charts");
        fs::create_dir_all(&dest_charts_dir)?;
        for chart in fs::read_dir(src_charts_dir)? {
            let chart = chart?;
            if chart
                .path()
                .extension()
                .is_some_and(|extension| extension == "svg")
            {
                fs::copy(chart.path(), dest_charts_dir.join(chart.file_name()))?;
            }
        }
    }

    Ok(())
}

fn site_environment(environment: EnvironmentSummary) -> SiteEnvironment {
    SiteEnvironment {
        cpu: environment.cpu,
        os: environment.os,
        kernel: environment.kernel,
        rustc: environment.rustc,
        llvm: environment.llvm,
    }
}

fn fallback_environment(cpu: &str) -> EnvironmentSummary {
    EnvironmentSummary {
        cpu: cpu.to_owned(),
        os: "unknown".to_owned(),
        kernel: "unknown".to_owned(),
        rustc: "unknown".to_owned(),
        llvm: "unknown".to_owned(),
    }
}

fn list_hosts(workspace_root: &Path) -> io::Result<Vec<HostInfo>> {
    let results_root = workspace_root.join("results");
    if !results_root.is_dir() {
        return Ok(Vec::new());
    }

    let mut hosts = Vec::new();
    for entry in fs::read_dir(results_root)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        if !path.join("charts").is_dir() {
            continue;
        }
        let id = entry.file_name().to_string_lossy().into_owned();
        let title = read_host_title(&path).unwrap_or_else(|| id.clone());
        hosts.push(HostInfo { id, title });
    }

    hosts.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(hosts)
}

fn list_hosts_with_chart(
    workspace_root: &Path,
    hosts: &[HostInfo],
    chart: &ChartSpec,
) -> io::Result<Vec<HostInfo>> {
    let mut matched = Vec::new();
    for host in hosts {
        let chart_path = workspace_root
            .join("results")
            .join(&host.id)
            .join("charts")
            .join(chart.dest_path);
        if chart_path.is_file() {
            matched.push(host.clone());
        }
    }
    Ok(matched)
}

fn read_host_title(host_result_dir: &Path) -> Option<String> {
    if let Some(cpu) = read_cpu_from_metadata(host_result_dir) {
        return Some(cpu);
    }

    let readme = fs::read_to_string(host_result_dir.join("README.md")).ok()?;
    for line in readme.lines() {
        if let Some(value) = line.strip_prefix("- CPU:") {
            let value = value.trim();
            if !value.is_empty() {
                return Some(value.to_owned());
            }
        }
    }
    None
}

fn latest_result_run_at(workspace_root: &Path, hosts: &[HostInfo]) -> Option<String> {
    hosts
        .iter()
        .filter_map(|host| {
            let host_result_dir = workspace_root.join("results").join(&host.id);
            read_host_run_at(&host_result_dir)
        })
        .max()
        .map(|value| normalize_run_at_timestamp(&value).unwrap_or(value))
}

fn read_host_run_at(host_result_dir: &Path) -> Option<String> {
    let readme = fs::read_to_string(host_result_dir.join("README.md")).ok()?;
    for line in readme.lines() {
        if let Some(value) = line.strip_prefix("Running at ") {
            let value = value.trim().strip_suffix('.').unwrap_or(value).trim();
            if !value.is_empty() {
                return Some(value.to_owned());
            }
        }
    }
    None
}

fn normalize_run_at_timestamp(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    if bytes.len() != 25 || !value.is_ascii() || bytes[10] != b' ' || bytes[19] != b' ' {
        return None;
    }

    if bytes[20] != b'+' && bytes[20] != b'-' {
        return None;
    }

    Some(format!(
        "{}T{}{}:{}",
        &value[0..10],
        &value[11..19],
        &value[20..23],
        &value[23..25]
    ))
}

fn chart_markdown_path(host: &str, chart_file: &str) -> String {
    format!("../results/{host}/charts/{chart_file}")
}

fn site_chart_path(host: &str, chart_file: &str) -> String {
    format!("results/{host}/charts/{chart_file}")
}

fn host_readme_markdown_path(host: &str) -> String {
    format!("../results/{host}/README.md")
}

fn chart_id(chart_file: &str) -> String {
    chart_file
        .strip_suffix(".svg")
        .unwrap_or(chart_file)
        .to_owned()
}

fn scope_title(scope: Scope) -> &'static str {
    match scope {
        Scope::Hash => "Hash",
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

    use super::{build_site_results, copy_site_chart_assets, write_scope_results_markdown};
    use crate::scope::Scope;

    #[test]
    fn aggregate_uses_host_readme_link_and_alt_text() {
        let root = temp_dir("aggregate");
        fs::create_dir_all(root.join("results/apple-m1/charts")).expect("create charts dir");
        fs::create_dir_all(root.join("bench_hash")).expect("create bench_hash");

        let readme = "\
# Benchmark Results

## Environment

- CPU: Apple M1
";
        fs::write(root.join("results/apple-m1/README.md"), readme).expect("write readme");
        fs::write(
            root.join("results/apple-m1/environment.ini"),
            "[environment]\ncpu = Apple M1\n",
        )
        .expect("write meta");
        fs::write(
            root.join("results/apple-m1/charts/non_cryptographic_hash_lines_throughput.svg"),
            "<svg/>",
        )
        .expect("write chart");
        fs::write(
            root.join("results/apple-m1/charts/cryptographic_hash_lines_throughput.svg"),
            "<svg/>",
        )
        .expect("write chart");

        write_scope_results_markdown(&root, Scope::Hash).expect("aggregate should succeed");

        let output = fs::read_to_string(root.join("bench_hash/RESULTS.md")).expect("read output");
        assert!(output.contains("### [Apple M1](../results/apple-m1/README.md)"));
        assert!(output.contains("![Non-Cryptographic Hash Throughput (Apple M1)]"));
        assert!(output.contains("![Cryptographic Hash Throughput (Apple M1)]"));

        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn site_results_json_lists_hosts_environment_and_available_charts() {
        let root = temp_dir("site-results");
        fs::create_dir_all(root.join("results/apple-m1/charts")).expect("create charts dir");
        fs::create_dir_all(root.join("results/empty-host/charts")).expect("create charts dir");
        fs::write(
            root.join("results/apple-m1/environment.ini"),
            "\
[environment]
cpu = Apple M1
os = macOS
kernel = Darwin
rustc = rustc 1.92.0
llvm = 21.1.3
",
        )
        .expect("write meta");
        fs::write(
            root.join("results/apple-m1/README.md"),
            "Running at 2026-02-28 15:36:59 +0800.\n",
        )
        .expect("write readme");
        fs::write(
            root.join("results/empty-host/README.md"),
            "Running at 2026-02-28 16:44:54 +0800.\n",
        )
        .expect("write readme");
        fs::write(
            root.join("results/apple-m1/charts/non_cryptographic_hash_lines_throughput.svg"),
            "<svg/>",
        )
        .expect("write chart");

        let output = build_site_results(&root).expect("build results json");

        assert_eq!(output.hosts.len(), 2);
        assert_eq!(output.generated_at, "2026-02-28T16:44:54+08:00");
        assert_eq!(output.hosts[0].id, "apple-m1");
        assert_eq!(output.hosts[0].environment.cpu, "Apple M1");
        let hash = output
            .scopes
            .iter()
            .find(|scope| scope.id == "hash")
            .expect("hash scope");
        assert_eq!(hash.charts.len(), 1);
        assert_eq!(hash.charts[0].hosts.len(), 1);
        assert_eq!(
            hash.charts[0].hosts[0].src,
            "results/apple-m1/charts/non_cryptographic_hash_lines_throughput.svg"
        );

        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn site_chart_assets_are_copied_to_public_results() {
        let root = temp_dir("site-assets");
        let public = root.join("site/public");
        fs::create_dir_all(root.join("results/apple-m1/charts")).expect("create charts dir");
        fs::create_dir_all(&public).expect("create public dir");
        fs::write(
            root.join("results/apple-m1/charts/u64_generation_lines_throughput.svg"),
            "<svg/>",
        )
        .expect("write chart");

        copy_site_chart_assets(&root, &public).expect("copy assets");

        assert!(
            public
                .join("results/apple-m1/charts/u64_generation_lines_throughput.svg")
                .is_file()
        );

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
