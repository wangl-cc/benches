import { Activity, BarChart3 } from "lucide-react";
import { colorForRsd } from "../colors";
import { formatLatencyValue, formatNumber, formatRsd } from "../format";
import { buildStabilityGroups, buildTailLatencyBands } from "../model";
import type { GroupedBarGroup, GroupedBarRow, RankingGroup, ResultRow, TailLatencyMetric } from "../types";
import { GroupedBarPanel } from "./GroupedBarPanel";
import { ControlGroup, EmptyPanel, PanelHeader, SegmentedControl } from "./common";
import { MetricBar, MetricGroupList, MetricRow } from "./MetricGroupList";

export function PerformanceRankingChart({
  groups,
  groupMode,
  focusedAlgorithm,
  focusedPlatform,
  onGroupModeChange,
  onFocusAlgorithm,
  onFocusPlatform,
}: {
  rows: ResultRow[];
  groups: GroupedBarGroup[];
  groupMode: RankingGroup;
  focusedAlgorithm: string | null;
  focusedPlatform: string | null;
  onGroupModeChange: (group: RankingGroup) => void;
  onFocusAlgorithm: (algorithm: string) => void;
  onFocusPlatform: (hostId: string) => void;
}) {
  return (
    <GroupedBarPanel
      title="Throughput Rank"
      icon={BarChart3}
      emptyTitle="No ranking data for this selection"
      ariaLabel="Throughput ranking bar chart"
      groups={groups}
      focusedAlgorithm={focusedAlgorithm}
      focusedPlatform={focusedPlatform}
      controls={
        <ControlGroup label="Group by">
          <SegmentedControl
            values={["algorithm", "platform"]}
            activeValue={groupMode}
            onChange={(value) => onGroupModeChange(value as RankingGroup)}
          />
        </ControlGroup>
      }
      onRowActivate={(row) => {
        if (groupMode === "algorithm") {
          onFocusPlatform(row.hostId);
        } else {
          onFocusAlgorithm(row.algorithm);
        }
      }}
    />
  );
}

export function TailLatencyPanel({
  rows,
  tailMetric,
  groupMode,
  focusedAlgorithm,
  focusedPlatform,
  onTailMetricChange,
  onFocusAlgorithm,
  onFocusPlatform,
}: {
  rows: ResultRow[];
  tailMetric: TailLatencyMetric;
  groupMode: RankingGroup;
  focusedAlgorithm: string | null;
  focusedPlatform: string | null;
  onTailMetricChange: (metric: TailLatencyMetric) => void;
  onFocusAlgorithm: (algorithm: string) => void;
  onFocusPlatform: (hostId: string) => void;
}) {
  const tailGroups = buildTailLatencyBands(rows, tailMetric, groupMode);
  const tailRows = tailGroups.flatMap((group) => group.rows);
  const values = tailRows.flatMap((row) => [row.p50, row.p90, row.p95]).filter((value): value is number => value !== undefined);
  const minValue = Math.min(...values, 0);
  const maxValue = Math.max(...values, 1);
  const valueRange = Math.max(maxValue - minValue, Number.EPSILON);
  const position = (value?: number) => {
    if (value === undefined) {
      return "0%";
    }
    return `${2 + ((value - minValue) / valueRange) * 96}%`;
  };

  return (
    <section className="panel latency-panel">
      <PanelHeader
        title="Tail Latency"
        icon={Activity}
        controls={
          <ControlGroup label="Sort">
            <SegmentedControl
              values={["p50", "p90", "p95"]}
              activeValue={tailMetric}
              onChange={(value) => onTailMetricChange(value as TailLatencyMetric)}
            />
          </ControlGroup>
        }
      />
      {tailRows.length === 0 ? (
        <EmptyPanel title="No tail latency in this run" />
      ) : (
        <MetricGroupList
          groups={tailGroups}
          ariaLabel={`${tailMetric.toUpperCase()} sorted tail latency plot`}
          renderRow={(row) => {
            const dimmed = Boolean(
              (focusedAlgorithm && focusedAlgorithm !== row.algorithm) ||
                (focusedPlatform && focusedPlatform !== row.hostId),
            );
            return (
              <MetricRow
                key={row.id}
                label={row.label}
                value={row.valueLabel}
                variant="latency"
                dimmed={dimmed}
                onActivate={() => {
                  if (groupMode === "algorithm") {
                    onFocusPlatform(row.hostId);
                  } else {
                    onFocusAlgorithm(row.algorithm);
                  }
                }}
              >
                <i
                  className="latency-range"
                  style={{ left: position(row.p50), width: `calc(${position(row.p95)} - ${position(row.p50)})` }}
                />
                <i className="latency-marker p50" style={{ left: position(row.p50), background: row.color }}>
                  <span className="sr-only">P50 {formatLatencyValue(row.p50 ?? 0)}</span>
                </i>
                <i className="latency-marker p90" style={{ left: position(row.p90), background: row.color }}>
                  <span className="sr-only">P90 {formatLatencyValue(row.p90 ?? 0)}</span>
                </i>
                <i className="latency-marker p95" style={{ left: position(row.p95), background: row.color }}>
                  <span className="sr-only">P95 {formatLatencyValue(row.p95 ?? 0)}</span>
                </i>
              </MetricRow>
            );
          }}
        />
      )}
    </section>
  );
}

export function StabilityPanel({
  rows,
  groupMode,
  focusedAlgorithm,
  focusedPlatform,
  onFocusAlgorithm,
  onFocusPlatform,
}: {
  rows: ResultRow[];
  groupMode: RankingGroup;
  focusedAlgorithm: string | null;
  focusedPlatform: string | null;
  onFocusAlgorithm: (algorithm: string) => void;
  onFocusPlatform: (hostId: string) => void;
}) {
  const groups = buildStabilityGroups(rows, groupMode);
  const stabilityRows = groups.flatMap((group) => group.rows);
  const maxRsd = Math.max(...stabilityRows.map((row) => row.value), 0.05);

  return (
    <section className="panel stability-panel">
      <PanelHeader title="Stability (RSD)" icon={Activity} />
      {stabilityRows.length === 0 ? (
        <EmptyPanel title="No stability data" />
      ) : (
        <MetricGroupList
          groups={groups}
          ariaLabel="Relative standard deviation stability chart"
          renderRow={(row) => (
            <StabilityRow
              key={row.id}
              row={row}
              maxRsd={maxRsd}
              dimmed={Boolean(
                (focusedAlgorithm && focusedAlgorithm !== row.algorithm) ||
                  (focusedPlatform && focusedPlatform !== row.hostId),
              )}
              onActivate={() => {
                if (groupMode === "algorithm") {
                  onFocusPlatform(row.hostId);
                } else {
                  onFocusAlgorithm(row.algorithm);
                }
              }}
            />
          )}
        />
      )}
    </section>
  );
}

function StabilityRow({
  row,
  maxRsd,
  dimmed,
  onActivate,
}: {
  row: GroupedBarRow;
  maxRsd: number;
  dimmed: boolean;
  onActivate: () => void;
}) {
  const width = `${Math.max(2, (row.value / maxRsd) * 100)}%`;
  const detail = `${row.label}: ${formatRsd(row.relativeStdDev)} RSD, ${formatNumber.format(row.samples ?? 0)} samples`;
  return (
    <MetricRow
      label={row.label}
      value={formatRsd(row.relativeStdDev)}
      variant="stability"
      dimmed={dimmed}
      beforeTrack={<span className="stability-swatch" style={{ background: colorForRsd(row.relativeStdDev) }} />}
      screenReaderDetail={detail}
      onActivate={onActivate}
    >
      <MetricBar width={width} color={colorForRsd(row.relativeStdDev)} />
    </MetricRow>
  );
}
