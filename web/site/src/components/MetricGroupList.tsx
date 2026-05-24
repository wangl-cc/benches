import type { ReactNode } from "react";

export type MetricGroup<Row> = {
  id: string;
  label: string;
  rows: Row[];
};

export function MetricGroupList<Row>({
  groups,
  ariaLabel,
  renderRow,
}: {
  groups: MetricGroup<Row>[];
  ariaLabel: string;
  renderRow: (row: Row) => ReactNode;
}) {
  return (
    <div className="metric-list" role="img" aria-label={ariaLabel}>
      {groups.map((group) => (
        <div className="metric-group" key={group.id}>
          <strong>{group.label}</strong>
          {group.rows.map(renderRow)}
        </div>
      ))}
    </div>
  );
}

export function MetricRow({
  label,
  value,
  variant,
  dimmed,
  beforeTrack,
  children,
  screenReaderDetail,
  onActivate,
}: {
  label: string;
  value: ReactNode;
  variant: "bar" | "latency" | "stability";
  dimmed: boolean;
  beforeTrack?: ReactNode;
  children: ReactNode;
  screenReaderDetail?: string;
  onActivate: () => void;
}) {
  const classes = ["metric-row", `metric-row--${variant}`];
  if (dimmed) {
    classes.push("dimmed");
  }

  return (
    <button type="button" className={classes.join(" ")} onClick={onActivate}>
      <span className="metric-label">{label}</span>
      {beforeTrack}
      <span className={`metric-track metric-track--${variant}`}>
        {children}
      </span>
      <span className="metric-value">{value}</span>
      {screenReaderDetail ? <span className="sr-only">{screenReaderDetail}</span> : null}
    </button>
  );
}

export function MetricBar({ width, color }: { width: string; color: string }) {
  return <i style={{ width, background: color }} />;
}
