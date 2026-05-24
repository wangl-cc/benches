use std::time::{SystemTime, UNIX_EPOCH};

use crate::{HarnessError, Result};

pub(crate) fn rfc3339_now() -> Result<String> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| HarnessError::with_source("system clock is before Unix epoch", error))?;
    Ok(format_rfc3339(now.as_secs()))
}

pub(crate) fn run_id(created_at: &str) -> Result<String> {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| HarnessError::with_source("system clock is before Unix epoch", error))?
        .subsec_nanos();
    Ok(format!(
        "{}-{}-{nanos:09}",
        created_at
            .chars()
            .filter(|ch| ch.is_ascii_digit())
            .collect::<String>(),
        std::process::id()
    ))
}

pub(crate) fn format_rfc3339(unix_seconds: u64) -> String {
    let days = (unix_seconds / 86_400) as i64;
    let seconds_of_day = unix_seconds % 86_400;
    let (year, month, day) = civil_from_days(days);
    let hour = seconds_of_day / 3600;
    let minute = (seconds_of_day % 3600) / 60;
    let second = seconds_of_day % 60;
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
}

fn civil_from_days(days_since_epoch: i64) -> (i32, u32, u32) {
    let z = days_since_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    let year = y + if month <= 2 { 1 } else { 0 };
    (year as i32, month as u32, day as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unix_epoch_formats_as_rfc3339_utc() {
        assert_eq!(format_rfc3339(0), "1970-01-01T00:00:00Z");
        assert_eq!(format_rfc3339(86_400), "1970-01-02T00:00:00Z");
    }
}
