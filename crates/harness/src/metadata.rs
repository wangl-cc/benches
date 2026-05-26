#[cfg(target_os = "linux")]
use std::fs;
use std::{env::consts, process::Command};

use serde::Serialize;

use crate::{HarnessError, Result, util::workspace_root};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitInfo {
    commit: String,
    branch: String,
    dirty: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HostInfo {
    os: String,
    arch: String,
    cpu: String,
    kernel: String,
    rustc: String,
    llvm: String,
}

impl GitInfo {
    pub(crate) fn detect() -> Result<Self> {
        let commit = command_stdout("git", &["rev-parse", "--short=12", "HEAD"])?;
        let branch = command_stdout("git", &["branch", "--show-current"])?;
        let dirty = command_stdout("git", &["status", "--porcelain"])?;
        let branch = if branch.is_empty() {
            "detached".to_owned()
        } else {
            branch
        };
        Ok(Self {
            commit: require_non_empty("git rev-parse --short=12 HEAD", commit)?,
            branch,
            dirty: !dirty.is_empty(),
        })
    }
}

impl HostInfo {
    pub(crate) fn detect() -> Result<Self> {
        let compiler = command_stdout("rustc", &["-Vv"])?;
        let (rustc, llvm) = parse_rustc_verbose(&compiler)?;
        Ok(Self {
            os: consts::OS.to_owned(),
            arch: consts::ARCH.to_owned(),
            cpu: detect_cpu()?,
            kernel: require_non_empty("uname -sr", command_stdout("uname", &["-sr"])?)?,
            rustc,
            llvm,
        })
    }
}

fn command_stdout(command: &str, args: &[&str]) -> Result<String> {
    let output = Command::new(command)
        .args(args)
        .current_dir(workspace_root())
        .output()
        .map_err(|error| {
            HarnessError::with_source(
                format!(
                    "failed to run metadata command: {command} {}",
                    args.join(" ")
                ),
                error,
            )
        })?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        let detail = if stderr.is_empty() {
            format!("status {}", output.status)
        } else {
            format!("status {}: {stderr}", output.status)
        };
        return Err(HarnessError::new(format!(
            "metadata command failed: {command} {} ({detail})",
            args.join(" ")
        )));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

fn require_non_empty(label: &str, value: String) -> Result<String> {
    if value.is_empty() {
        return Err(HarnessError::new(format!(
            "metadata command returned empty output: {label}"
        )));
    }
    Ok(value)
}

fn parse_rustc_verbose(output: &str) -> Result<(String, String)> {
    let rustc = output
        .lines()
        .next()
        .filter(|line| !line.trim().is_empty())
        .ok_or_else(|| HarnessError::new("rustc -Vv did not include rustc version"))?
        .to_owned();
    let llvm = output
        .lines()
        .find_map(|line| line.strip_prefix("LLVM version:"))
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .ok_or_else(|| HarnessError::new("rustc -Vv did not include LLVM version"))?
        .to_owned();
    Ok((rustc, llvm))
}

fn detect_cpu() -> Result<String> {
    #[cfg(target_os = "linux")]
    {
        let content = fs::read_to_string("/proc/cpuinfo").map_err(|error| {
            HarnessError::with_source(
                "failed to read Linux CPU metadata from /proc/cpuinfo",
                error,
            )
        })?;
        for line in content.lines() {
            for key in ["model name", "Hardware"] {
                if line.starts_with(key)
                    && let Some((_, value)) = line.split_once(':')
                {
                    let value = value.trim();
                    if !value.is_empty() {
                        return Ok(value.to_owned());
                    }
                }
            }
        }
        return Err(HarnessError::new(
            "Linux CPU metadata did not include model name or Hardware",
        ));
    }

    #[cfg(target_os = "macos")]
    {
        let mut errors = Vec::new();

        match command_stdout("sysctl", &["-n", "machdep.cpu.brand_string"]) {
            Ok(cpu) if !cpu.is_empty() => return Ok(cpu),
            Ok(_) => {
                errors.push("sysctl -n machdep.cpu.brand_string returned empty output".to_owned())
            }
            Err(error) => errors.push(error.to_string()),
        }

        match command_stdout("system_profiler", &["SPHardwareDataType"]) {
            Ok(output) => {
                if let Some(cpu) = parse_macos_cpu_from_system_profiler(&output) {
                    return Ok(cpu.to_owned());
                }
                errors.push(
                    "system_profiler SPHardwareDataType did not include CPU metadata".to_owned(),
                );
            }
            Err(error) => errors.push(error.to_string()),
        }

        match command_stdout("sysctl", &["-n", "hw.model"]) {
            Ok(model) if !model.is_empty() => return Ok(model),
            Ok(_) => errors.push("sysctl -n hw.model returned empty output".to_owned()),
            Err(error) => errors.push(error.to_string()),
        }

        Err(HarnessError::new(format!(
            "failed to detect macOS CPU metadata: {}",
            errors.join("; ")
        )))
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        require_non_empty("uname -m", command_stdout("uname", &["-m"])?)
    }
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

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub(crate) fn test_git() -> GitInfo {
        GitInfo {
            commit: "abc123".to_owned(),
            branch: "main".to_owned(),
            dirty: false,
        }
    }

    pub(crate) fn test_host() -> HostInfo {
        HostInfo {
            os: "test".to_owned(),
            arch: "test".to_owned(),
            cpu: "test".to_owned(),
            kernel: "test".to_owned(),
            rustc: "rustc test".to_owned(),
            llvm: "test".to_owned(),
        }
    }
}
