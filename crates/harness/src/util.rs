use std::{
    env,
    hint::black_box,
    path::{Path, PathBuf},
    time::Duration,
};

pub(crate) fn splitmix64(state: &mut u64) -> u64 {
    *state = state.wrapping_add(0x9e37_79b9_7f4a_7c15);
    let mut z = *state;
    z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    z ^ (z >> 31)
}

pub(crate) fn checksum_mix(acc: u128, value: u128) -> u128 {
    let mixed = acc ^ value.wrapping_add(0x9e37_79b9_7f4a_7c15_6a09_e667_f3bc_c909);
    mixed
        .rotate_left(17)
        .wrapping_mul(0x1000_0000_0000_0000_0000_0000_0000_013b)
}

pub(crate) fn checksum_hex(value: u128) -> String {
    format!("{value:032x}")
}

pub(crate) fn duration_ns(duration: Duration) -> u128 {
    duration.as_nanos()
}

pub(crate) fn black_box_value<T>(value: T) -> T {
    black_box(value)
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
