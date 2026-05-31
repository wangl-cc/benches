create table runs (
  run_id text primary key,
  content_hash text not null,
  host_id text not null,
  benchmark_name text not null,
  created_at text not null,
  uploaded_at integer not null,
  schema_version text not null,
  raw_json_gzip blob not null,
  raw_json_encoding text not null check (raw_json_encoding = 'gzip'),
  raw_json_bytes integer not null,
  raw_json_gzip_bytes integer not null,
  git_json text not null,
  host_json text not null,
  harness_json text not null
);

create index runs_created_at_idx on runs (created_at desc, uploaded_at desc);
create index runs_content_hash_idx on runs (content_hash);
create index runs_host_idx on runs (host_id);
create index runs_benchmark_idx on runs (benchmark_name);

create table run_cases (
  run_id text not null references runs (run_id) on delete cascade,
  case_id text not null,
  benchmark_name text,
  name text,
  case_json text not null,
  primary key (run_id, case_id)
);

create index run_cases_benchmark_idx on run_cases (benchmark_name);

create table run_summaries (
  run_id text not null references runs (run_id) on delete cascade,
  summary_index integer not null,
  benchmark_name text,
  case_id text,
  metric text,
  unit text,
  value real,
  summary_json text not null,
  primary key (run_id, summary_index)
);

create index run_summaries_benchmark_idx on run_summaries (benchmark_name);
create index run_summaries_case_idx on run_summaries (case_id);
create index run_summaries_metric_idx on run_summaries (metric);
create index run_summaries_lookup_idx on run_summaries (benchmark_name, case_id, metric);
