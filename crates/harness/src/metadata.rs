#[cfg(target_os = "linux")]
use std::fs;
use std::{env::consts, process::Command};

use serde::Serialize;

use crate::util::workspace_root;

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

pub(crate) fn detect_git(warnings: &mut Vec<String>) -> GitInfo {
    let commit = command_stdout("git", &["rev-parse", "--short=12", "HEAD"], warnings)
        .unwrap_or_else(|| "unknown".to_owned());
    let branch = command_stdout("git", &["branch", "--show-current"], warnings)
        .filter(|branch| !branch.is_empty())
        .unwrap_or_else(|| "unknown".to_owned());
    let dirty = command_stdout("git", &["status", "--porcelain"], warnings)
        .map(|status| !status.is_empty())
        .unwrap_or(false);
    GitInfo {
        commit,
        branch,
        dirty,
    }
}

pub(crate) fn detect_host(warnings: &mut Vec<String>) -> HostInfo {
    let compiler = command_stdout("rustc", &["-Vv"], warnings);
    let (rustc, llvm) = compiler
        .as_deref()
        .map(parse_rustc_verbose)
        .unwrap_or_else(|| ("unknown".to_owned(), "unknown".to_owned()));
    HostInfo {
        os: consts::OS.to_owned(),
        arch: consts::ARCH.to_owned(),
        cpu: detect_cpu(warnings).unwrap_or_else(|| consts::ARCH.to_owned()),
        kernel: command_stdout("uname", &["-sr"], warnings).unwrap_or_else(|| "unknown".to_owned()),
        rustc,
        llvm,
    }
}

fn command_stdout(command: &str, args: &[&str], warnings: &mut Vec<String>) -> Option<String> {
    match Command::new(command)
        .args(args)
        .current_dir(workspace_root())
        .output()
    {
        Ok(output) if output.status.success() => {
            Some(String::from_utf8_lossy(&output.stdout).trim().to_owned())
        }
        Ok(output) => {
            warnings.push(format!(
                "command failed: {command} {} (status {})",
                args.join(" "),
                output.status
            ));
            None
        }
        Err(error) => {
            warnings.push(format!(
                "command could not run: {command} {} ({error})",
                args.join(" ")
            ));
            None
        }
    }
}

fn parse_rustc_verbose(output: &str) -> (String, String) {
    let rustc = output
        .lines()
        .next()
        .filter(|line| !line.trim().is_empty())
        .unwrap_or("unknown")
        .to_owned();
    let llvm = output
        .lines()
        .find_map(|line| line.strip_prefix("LLVM version:"))
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .unwrap_or("unknown")
        .to_owned();
    (rustc, llvm)
}

fn detect_cpu(warnings: &mut Vec<String>) -> Option<String> {
    #[cfg(target_os = "linux")]
    {
        match fs::read_to_string("/proc/cpuinfo") {
            Ok(content) => {
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
            Err(error) => warnings.push(format!("failed to read /proc/cpuinfo: {error}")),
        }
    }

    #[cfg(target_os = "macos")]
    {
        for key in ["machdep.cpu.brand_string", "hw.model"] {
            if let Some(cpu) = command_stdout_quiet("sysctl", &["-n", key])
                && !cpu.is_empty()
            {
                return Some(cpu);
            }
        }

        if let Some(output) = command_stdout_quiet("system_profiler", &["SPHardwareDataType"])
            && let Some(cpu) = parse_macos_cpu_from_system_profiler(&output)
        {
            return Some(cpu.to_owned());
        }
    }

    command_stdout("uname", &["-m"], warnings).filter(|cpu| !cpu.is_empty())
}

fn command_stdout_quiet(command: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(command)
        .args(args)
        .current_dir(workspace_root())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let value = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    (!value.is_empty()).then_some(value)
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
