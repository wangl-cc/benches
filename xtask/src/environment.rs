use std::{env::consts, fs, io::Write, path::Path};

use crate::util::{run_capture, slugify};

pub const ENV_METADATA_FILE: &str = "environment.ini";
const ENV_METADATA_FILE_LEGACY: &str = "environment.meta";

#[derive(Debug, Clone)]
pub struct BenchmarkEnvironment {
    os: Option<String>,
    kernel_release: Option<String>,
    cpu: Option<String>,
    compiler: CompilerSpec,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnvironmentSummary {
    pub cpu: String,
    pub os: String,
    pub kernel: String,
    pub rustc: String,
    pub llvm: String,
}

impl BenchmarkEnvironment {
    pub fn detect() -> Self {
        Self {
            cpu: detect_cpu(),
            os: detect_os(),
            kernel_release: run_capture("uname", &["-sr"]),
            compiler: CompilerSpec::detect(),
        }
    }

    pub fn result_name(&self) -> String {
        normalize_result_name(self.cpu())
    }

    pub fn write_markdown(&self, writer: &mut impl Write) -> std::io::Result<()> {
        writeln!(writer, "## Environment")?;
        writeln!(writer)?;
        writeln!(writer, "- CPU: {}", self.cpu())?;
        writeln!(writer, "- OS: {}", self.os())?;
        writeln!(writer, "- Kernel: {}", self.kernel_release())?;
        writeln!(writer, "- rustc: {}", self.compiler.rustc)?;
        writeln!(writer, "- LLVM: {}", self.compiler.llvm)?;
        Ok(())
    }

    pub fn write_metadata_file(&self, result_dir: &Path) -> std::io::Result<()> {
        fs::write(result_dir.join(ENV_METADATA_FILE), self.encode_ini())
    }

    fn encode_ini(&self) -> String {
        let mut out = String::new();
        out.push_str("[environment]\n");
        out.push_str(&format!("cpu = {}\n", encode_meta_value(self.cpu())));
        out.push_str(&format!("os = {}\n", encode_meta_value(self.os())));
        out.push_str(&format!(
            "kernel = {}\n",
            encode_meta_value(self.kernel_release())
        ));
        out.push_str(&format!(
            "rustc = {}\n",
            encode_meta_value(&self.compiler.rustc)
        ));
        out.push_str(&format!(
            "llvm = {}\n",
            encode_meta_value(&self.compiler.llvm)
        ));
        out
    }

    fn decode_ini(input: &str) -> Result<Self, String> {
        let mut current_section: Option<&str> = None;
        let mut cpu: Option<String> = None;
        let mut os: Option<String> = None;
        let mut kernel: Option<String> = None;
        let mut rustc: Option<String> = None;
        let mut llvm: Option<String> = None;

        for raw_line in input.lines() {
            let line = raw_line.trim();
            if line.is_empty() || line.starts_with('#') || line.starts_with(';') {
                continue;
            }
            if line.starts_with('[') && line.ends_with(']') {
                current_section = Some(&line[1..line.len() - 1]);
                continue;
            }
            if let Some(section) = current_section
                && section != "environment"
            {
                continue;
            }

            let (key, value) = line
                .split_once('=')
                .ok_or_else(|| format!("invalid metadata line: {line}"))?;
            let key = key.trim();
            let value = decode_meta_value(value.trim());
            match key {
                "cpu" => cpu = Some(value),
                "os" => os = Some(value),
                "kernel" => kernel = Some(value),
                "rustc" => rustc = Some(value),
                "llvm" => llvm = Some(value),
                _ => {}
            }
        }

        let cpu = cpu.ok_or_else(|| "missing metadata key: cpu".to_owned())?;
        Ok(Self {
            os: option_if_non_empty(os),
            kernel_release: option_if_non_empty(kernel),
            cpu: option_if_non_empty(Some(cpu)),
            compiler: CompilerSpec {
                rustc: rustc.unwrap_or_else(|| "not found".to_owned()),
                llvm: llvm.unwrap_or_else(|| "not found".to_owned()),
            },
        })
    }

    fn os(&self) -> &str {
        self.os.as_deref().unwrap_or("unknown")
    }

    fn kernel_release(&self) -> &str {
        self.kernel_release.as_deref().unwrap_or("unknown")
    }

    fn cpu(&self) -> &str {
        self.cpu.as_deref().unwrap_or(consts::ARCH)
    }

    fn summary(&self) -> EnvironmentSummary {
        EnvironmentSummary {
            cpu: self.cpu().to_owned(),
            os: self.os().to_owned(),
            kernel: self.kernel_release().to_owned(),
            rustc: self.compiler.rustc.clone(),
            llvm: self.compiler.llvm.clone(),
        }
    }
}

pub fn read_cpu_from_metadata(result_dir: &Path) -> Option<String> {
    let environment = read_environment_summary(result_dir)?;
    let cpu = environment.cpu.trim();
    if cpu.is_empty() {
        return None;
    }
    Some(cpu.to_owned())
}

pub fn read_environment_summary(result_dir: &Path) -> Option<EnvironmentSummary> {
    let raw = read_metadata_raw(result_dir)?;
    BenchmarkEnvironment::decode_ini(&raw)
        .ok()
        .map(|environment| environment.summary())
}

fn read_metadata_raw(result_dir: &Path) -> Option<String> {
    let new_path = result_dir.join(ENV_METADATA_FILE);
    if new_path.is_file() {
        return fs::read_to_string(new_path).ok();
    }

    let legacy_path = result_dir.join(ENV_METADATA_FILE_LEGACY);
    if legacy_path.is_file() {
        return fs::read_to_string(legacy_path).ok();
    }

    None
}

fn detect_cpu() -> Option<String> {
    #[cfg(target_os = "linux")]
    {
        let cpuinfo = Path::new("/proc/cpuinfo");
        if cpuinfo.exists()
            && let Ok(content) = fs::read_to_string(cpuinfo)
        {
            for line in content.lines() {
                for key in ["model name", "Hardware"] {
                    if line.starts_with(key)
                        && let Some((_, value)) = line.split_once(':')
                    {
                        let value = value.trim();
                        if !value.is_empty() {
                            return Some(value.to_owned());
                        }
                    }
                }
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Some(out) = run_capture("sysctl", &["-n", "machdep.cpu.brand_string"])
            && !out.is_empty()
        {
            return Some(out);
        }

        if let Some(out) = run_capture("system_profiler", &["SPHardwareDataType"])
            && let Some(cpu) = parse_macos_cpu_from_system_profiler(&out)
        {
            return Some(cpu.to_owned());
        }
    }

    if let Some(out) = run_capture("uname", &["-m"])
        && !out.is_empty()
    {
        return Some(out);
    }

    None
}

#[cfg(target_os = "macos")]
fn parse_macos_cpu_from_system_profiler(output: &str) -> Option<&str> {
    for line in output.lines() {
        let line = line.trim();
        if let Some(value) = line.strip_prefix("Chip:") {
            let value = value.trim();
            if !value.is_empty() {
                return Some(value);
            }
        }
        if let Some(value) = line.strip_prefix("Processor Name:") {
            let value = value.trim();
            if !value.is_empty() {
                return Some(value);
            }
        }
    }
    None
}

fn normalize_result_name(cpu: &str) -> String {
    slugify(cpu)
}

fn option_if_non_empty(value: Option<String>) -> Option<String> {
    match value {
        Some(value) if !value.trim().is_empty() => Some(value),
        _ => None,
    }
}

fn detect_os() -> Option<String> {
    #[cfg(target_os = "linux")]
    {
        let os_release = Path::new("/etc/os-release");
        if os_release.exists()
            && let Ok(content) = fs::read_to_string(os_release)
        {
            let mut pretty_name: Option<&str> = None;
            let mut name: Option<&str> = None;
            for line in content.lines() {
                if line.starts_with('#') || !line.contains('=') {
                    continue;
                }
                if let Some((key, value)) = line.split_once('=') {
                    let value = value.trim().trim_matches('"');
                    match key {
                        "PRETTY_NAME" => pretty_name = Some(value),
                        "NAME" => name = Some(value),
                        _ => {}
                    }
                }
            }
            if let Some(value) = pretty_name {
                return Some(value.to_owned());
            }
            if let Some(value) = name {
                return Some(value.to_owned());
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        let name = run_capture("sw_vers", &["-productName"]);
        let version = run_capture("sw_vers", &["-productVersion"]);
        let build = run_capture("sw_vers", &["-buildVersion"]);
        if let (Some(name), Some(version), Some(build)) = (name, version, build) {
            return Some(format!("{name} {version} ({build})"));
        }
    }

    None
}

#[derive(Debug, Clone)]
struct CompilerSpec {
    rustc: String,
    llvm: String,
}

impl CompilerSpec {
    fn unknown() -> Self {
        Self {
            rustc: "not found".to_owned(),
            llvm: "not found".to_owned(),
        }
    }

    fn detect() -> Self {
        let mut spec = Self::unknown();

        if let Some(rustc_vv) = run_capture("rustc", &["-Vv"]) {
            for line in rustc_vv.lines() {
                if line.starts_with("rustc ") {
                    spec.rustc = line.to_owned();
                }
                if let Some(value) = line.strip_prefix("LLVM version:") {
                    spec.llvm = value.trim().to_owned();
                }
            }
        }

        spec
    }
}

fn encode_meta_value(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            _ => out.push(ch),
        }
    }
    out
}

fn decode_meta_value(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut escaped = false;
    for ch in value.chars() {
        if escaped {
            match ch {
                'n' => out.push('\n'),
                'r' => out.push('\r'),
                '\\' => out.push('\\'),
                other => out.push(other),
            }
            escaped = false;
            continue;
        }
        if ch == '\\' {
            escaped = true;
            continue;
        }
        out.push(ch);
    }
    if escaped {
        out.push('\\');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{BenchmarkEnvironment, decode_meta_value, encode_meta_value};

    #[test]
    fn metadata_roundtrip() {
        let env = BenchmarkEnvironment {
            os: Some("macOS 26.3 (25D125)".to_owned()),
            kernel_release: Some("Darwin 25.3.0".to_owned()),
            cpu: Some("Apple M1".to_owned()),
            compiler: super::CompilerSpec {
                rustc: "rustc 1.93.1".to_owned(),
                llvm: "21.1.8".to_owned(),
            },
        };
        let encoded = env.encode_ini();
        let decoded = BenchmarkEnvironment::decode_ini(&encoded).expect("decode should succeed");
        assert_eq!(decoded.cpu(), "Apple M1");
        assert_eq!(decoded.os, Some("macOS 26.3 (25D125)".to_owned()));
        assert_eq!(decoded.kernel_release, Some("Darwin 25.3.0".to_owned()));
        assert_eq!(decoded.compiler.rustc, "rustc 1.93.1");
        assert_eq!(decoded.compiler.llvm, "21.1.8");
    }

    #[test]
    fn metadata_decode_legacy_without_section() {
        let decoded = BenchmarkEnvironment::decode_ini("cpu = Apple M1\n")
            .expect("legacy format should decode");
        assert_eq!(decoded.cpu(), "Apple M1");
    }

    #[test]
    fn meta_value_escape_roundtrip() {
        let raw = "line1\\line2\nline3\rline4";
        let escaped = encode_meta_value(raw);
        let unescaped = decode_meta_value(&escaped);
        assert_eq!(unescaped, raw);
    }

    #[test]
    fn parse_macos_cpu_from_system_profiler_chip() {
        #[cfg(target_os = "macos")]
        {
            let input = "Hardware:\n\n    Chip: Apple M1\n";
            let cpu = super::parse_macos_cpu_from_system_profiler(input);
            assert_eq!(cpu, Some("Apple M1"));
        }
    }

    #[test]
    fn parse_macos_cpu_from_system_profiler_processor_name() {
        #[cfg(target_os = "macos")]
        {
            let input = "Hardware:\n\n    Processor Name: Intel Core i9\n";
            let cpu = super::parse_macos_cpu_from_system_profiler(input);
            assert_eq!(cpu, Some("Intel Core i9"));
        }
    }
}
