create table runs (
  run_id text primary key,
  content_hash text not null,
  host_id text not null,
  created_at text not null,
  uploaded_at integer not null,
  schema_version text not null,
  r2_key text not null,
  git_json text not null,
  host_json text not null,
  harness_json text not null,
  checksums_json text not null,
  warnings_json text not null
);

create index runs_created_at_idx on runs (created_at desc, uploaded_at desc);
create index runs_content_hash_idx on runs (content_hash);
create index runs_host_idx on runs (host_id);

create table run_scopes (
  run_id text not null references runs (run_id) on delete cascade,
  scope_id text not null,
  title text,
  scope_json text not null,
  primary key (run_id, scope_id)
);

create table run_cases (
  run_id text not null references runs (run_id) on delete cascade,
  case_id text not null,
  scope_id text,
  name text,
  case_json text not null,
  primary key (run_id, case_id)
);

create index run_cases_scope_idx on run_cases (scope_id);

create table run_summaries (
  run_id text not null references runs (run_id) on delete cascade,
  summary_index integer not null,
  scope_id text,
  case_id text,
  metric text,
  unit text,
  value real,
  summary_json text not null,
  primary key (run_id, summary_index)
);

create index run_summaries_scope_idx on run_summaries (scope_id);
create index run_summaries_case_idx on run_summaries (case_id);
create index run_summaries_metric_idx on run_summaries (metric);
create index run_summaries_lookup_idx on run_summaries (scope_id, case_id, metric);
