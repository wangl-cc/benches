use time::{OffsetDateTime, format_description::well_known::Rfc3339};

use crate::{HarnessError, Result};

pub(crate) fn rfc3339_now() -> Result<String> {
    format_rfc3339(OffsetDateTime::now_utc())
}

pub(crate) fn run_id(created_at: &str) -> Result<String> {
    let nanos = OffsetDateTime::now_utc().unix_timestamp_nanos();
    if nanos < 0 {
        return Err(HarnessError::new("system clock is before Unix epoch"));
    }
    Ok(format!(
        "{}-{}-{nanos}",
        created_at
            .chars()
            .filter(|ch| ch.is_ascii_digit())
            .collect::<String>(),
        std::process::id()
    ))
}

fn format_rfc3339(time: OffsetDateTime) -> Result<String> {
    time.format(&Rfc3339)
        .map_err(|error| HarnessError::with_source("failed to format UTC timestamp", error))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unix_epoch_formats_as_rfc3339_utc() {
        let epoch = OffsetDateTime::from_unix_timestamp(0).expect("epoch");
        assert_eq!(
            format_rfc3339(epoch).expect("format"),
            "1970-01-01T00:00:00Z"
        );
    }
}
