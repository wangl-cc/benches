use std::{
    env,
    path::{Path, PathBuf},
    time::Duration,
};

pub(crate) fn duration_ns(duration: Duration) -> u128 {
    duration.as_nanos()
}

pub(crate) fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .find(|path| path.join("Cargo.lock").exists() && path.join("Cargo.toml").exists())
        .expect("harness crate must be inside a Cargo workspace")
        .to_path_buf()
}

pub fn slugify(value: &str) -> String {
    let mut out = String::new();
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    out.trim_matches('-').to_owned()
}
