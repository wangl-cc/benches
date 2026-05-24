import type { ElementType, ReactNode } from "react";
import type { GroupedBarGroup, GroupedBarRow } from "../types";
import { EmptyPanel, PanelHeader } from "./common";
import { MetricBar, MetricGroupList, MetricRow } from "./MetricGroupList";

export function GroupedBarPanel({
  title,
  icon: Icon,
  emptyTitle,
  ariaLabel,
  groups,
  controls,
  focusedAlgorithm,
  focusedPlatform,
  onRowActivate,
}: {
  title: string;
  icon: ElementType;
  emptyTitle: string;
  ariaLabel: string;
  groups: GroupedBarGroup[];
  controls: ReactNode;
  focusedAlgorithm: string | null;
  focusedPlatform: string | null;
  onRowActivate: (row: GroupedBarRow) => void;
}) {
  const rows = groups.flatMap((group) => group.rows);
  if (rows.length === 0) {
    return (
      <section className="panel grouped-bar-panel">
        <PanelHeader icon={Icon} title={title} controls={controls} />
        <EmptyPanel title={emptyTitle} />
      </section>
    );
  }

  const maxScore = Math.max(...rows.map((row) => row.score), 1);

  return (
    <section className="panel grouped-bar-panel">
      <PanelHeader icon={Icon} title={title} controls={controls} />
      <MetricGroupList
        groups={groups}
        ariaLabel={ariaLabel}
        renderRow={(row) => {
          const width = `${Math.max(3, (row.score / maxScore) * 100)}%`;
          const dimmed = Boolean(
            (focusedAlgorithm && focusedAlgorithm !== row.algorithm) ||
              (focusedPlatform && focusedPlatform !== row.hostId),
          );
          return (
            <MetricRow
              key={row.id}
              label={row.label}
              value={row.valueLabel}
              variant="bar"
              dimmed={dimmed}
              onActivate={() => onRowActivate(row)}
            >
              <MetricBar width={width} color={row.color} />
            </MetricRow>
          );
        }}
      />
    </section>
  );
}
