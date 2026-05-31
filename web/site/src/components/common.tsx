import type { ElementType, ReactNode } from "react";
import { labelize } from "../utils";

export function SegmentedControl({
  values,
  activeValue,
  onChange,
}: {
  values: string[];
  activeValue: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="segmented-control" role="radiogroup">
      <div className="segmented-options">
        {values.map((value) => (
          <button
            key={value}
            type="button"
            className={value === activeValue ? "active" : ""}
            role="radio"
            aria-checked={value === activeValue}
            onClick={() => onChange(value)}
          >
            {labelize(value)}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ControlGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="control-group">
      <span className="control-label">{label}</span>
      {children}
    </div>
  );
}

export function EmptyPanel({ title }: { title: string }) {
  return (
    <div className="empty-panel">
      <strong>{title}</strong>
      <span>Adjust filters in the left panel.</span>
    </div>
  );
}

export function PanelHeader({
  icon: Icon,
  title,
  controls,
}: {
  icon: ElementType;
  title: string;
  controls?: ReactNode;
}) {
  return (
    <div className="panel-title chart-title-row">
      <div>
        <Icon className="size-4" />
        <h2>{title}</h2>
      </div>
      {controls ? <div className="chart-tools">{controls}</div> : null}
    </div>
  );
}
