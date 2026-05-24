import type { ElementType, ReactNode } from "react";
import type { GroupedBarGroup, GroupedBarRow } from "../types";
import { EmptyPanel, PanelHeader } from "./common";

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
      <div className="grouped-bar-list" role="img" aria-label={ariaLabel}>
        {groups.map((group) => (
          <div className="grouped-bar-group" key={group.id}>
            <strong>{group.label}</strong>
            {group.rows.map((row) => {
              const width = `${Math.max(3, (row.score / maxScore) * 100)}%`;
              const dimmed = Boolean(
                (focusedAlgorithm && focusedAlgorithm !== row.algorithm) ||
                  (focusedPlatform && focusedPlatform !== row.hostId),
              );
              return (
                <button
                  key={row.id}
                  type="button"
                  className={dimmed ? "grouped-bar-row dimmed" : "grouped-bar-row"}
                  onClick={() => onRowActivate(row)}
                >
                  <span className="grouped-bar-label">{row.label}</span>
                  <span className="grouped-bar-track">
                    <i style={{ width, background: row.color }} />
                  </span>
                  <span className="grouped-bar-value">{row.valueLabel}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}
