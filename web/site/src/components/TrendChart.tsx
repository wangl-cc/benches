import { ResponsiveLine } from "@nivo/line";
import type { LineCustomSvgLayerProps, Point } from "@nivo/line";
import { ChevronDown, LineChart } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { colorForAlgorithm } from "../colors";
import { commonInputUnit, formatInputValue, formatMetricValue } from "../format";
import { AUTO_WORKLOAD } from "../model";
import type { AxisScale, TrendSeries } from "../types";
import { uniqueBy, uniqueSorted } from "../utils";
import { benchmarkChartTheme } from "./chartTheme";
import { ControlGroup, EmptyPanel, PanelHeader, SegmentedControl } from "./common";

type NivoTrendDatum = {
  x: number;
  y: number;
  label: string;
  unit?: string;
};

type NivoTrendSeries = {
  id: string;
  algorithm: string;
  hostId: string;
  platform: string;
  color: string;
  dash?: string;
  data: NivoTrendDatum[];
};

const MAX_X_TICKS = 5;

export function TrendChart({
  series,
  unit,
  xScaleMode,
  yScaleMode,
  activeWorkload,
  representativeWorkload,
  autoWorkload,
  workloads,
  focusedAlgorithm,
  focusedPlatform,
  onFocusAlgorithm,
  onFocusPlatform,
  onWorkloadChange,
  onXScaleChange,
  onYScaleChange,
}: {
  series: TrendSeries[];
  unit: string;
  xScaleMode: AxisScale;
  yScaleMode: AxisScale;
  activeWorkload: string;
  representativeWorkload: string;
  autoWorkload: string;
  workloads: string[];
  focusedAlgorithm: string | null;
  focusedPlatform: string | null;
  onFocusAlgorithm: (algorithm: string) => void;
  onFocusPlatform: (hostId: string) => void;
  onWorkloadChange: (workload: string) => void;
  onXScaleChange: (scale: AxisScale) => void;
  onYScaleChange: (scale: AxisScale) => void;
}) {
  const allPoints = series.flatMap((item) => item.points);
  const xUnit = commonInputUnit(allPoints);
  const legendAlgorithms = uniqueSorted(series.map((item) => item.algorithm));
  const legendPlatforms = uniqueBy(series, (item) => item.hostId).map((item) => ({
    hostId: item.hostId,
    platform: item.platform,
    dash: item.dash,
  }));
  const inputCandidates: Array<{ label: string; x: number }> = [...allPoints]
    .map((point) => ({ label: point.label, x: point.x }))
    .sort((leftPoint, rightPoint) => leftPoint.x - rightPoint.x);
  const selectableInputs = uniqueBy(inputCandidates, (point) => point.label);
  const selectedInput = selectableInputs.find((input) => input.label === representativeWorkload);
  const activeRankLabel = activeWorkload.startsWith(AUTO_WORKLOAD)
    ? representativeWorkload ? `Auto: ${representativeWorkload}` : AUTO_WORKLOAD
    : representativeWorkload;
  const xValues = uniqueNumbers(allPoints.map((point) => point.x));
  const yValues = uniqueNumbers(allPoints.map((point) => point.y));
  const xTickValues = sparseTicks(xValues, MAX_X_TICKS);
  const yDomain = paddedYDomain(yValues, yScaleMode);
  const chartData: NivoTrendSeries[] = series.map((item) => ({
    id: item.id,
    algorithm: item.algorithm,
    hostId: item.hostId,
    platform: item.platform,
    color: item.color,
    dash: item.dash,
    data: [...item.points]
      .sort((leftPoint, rightPoint) => leftPoint.x - rightPoint.x)
      .map((point) => ({
        x: point.x,
        y: point.y,
        label: point.label,
        unit: point.unit,
      })),
  }));
  const trendLayer = useMemo(
    () => makeTrendLayer(focusedAlgorithm, focusedPlatform, representativeWorkload, onWorkloadChange),
    [focusedAlgorithm, focusedPlatform, representativeWorkload, onWorkloadChange],
  );

  return (
    <section className="panel trend-panel">
      <PanelHeader
        icon={LineChart}
        title="Throughput vs Input Size"
        controls={
          <>
            <RankSizePicker
              value={activeWorkload || autoWorkload}
              label={activeRankLabel}
              workloads={workloads}
              onChange={onWorkloadChange}
            />
            <ControlGroup label="X">
              <SegmentedControl
                values={["linear", "log"]}
                activeValue={xScaleMode}
                onChange={(value) => onXScaleChange(value as AxisScale)}
              />
            </ControlGroup>
            <ControlGroup label="Y">
              <SegmentedControl
                values={["linear", "log"]}
                activeValue={yScaleMode}
                onChange={(value) => onYScaleChange(value as AxisScale)}
              />
            </ControlGroup>
          </>
        }
      />
      {series.length === 0 ? (
        <EmptyPanel title="Need multiple input sizes for a trend" />
      ) : (
        <div className="trend-body">
          <div className="trend-chart" role="img" aria-label="Input size trend line chart">
            <ResponsiveLine<NivoTrendSeries>
              data={chartData}
              theme={benchmarkChartTheme}
              margin={{ top: 24, right: 32, bottom: 42, left: 58 }}
              xScale={scaleSpec(xScaleMode)}
              yScale={scaleSpec(yScaleMode, yDomain.min, yDomain.max)}
              axisBottom={{
                tickSize: 4,
                tickPadding: 10,
                tickRotation: 0,
                tickValues: xTickValues,
                format: (value) => formatInputValue(Number(value), xUnit),
              }}
              axisLeft={{
                tickSize: 4,
                tickPadding: 8,
                tickRotation: 0,
                format: (value) => formatMetricValue(Number(value), unit),
              }}
              colors={(item) => item.color}
              curve="linear"
              enableGridX={false}
              enableGridY
              enablePoints={false}
              enableSlices={false}
              useMesh
              animate={false}
              lineWidth={2.2}
              xFormat={(value) => formatInputValue(Number(value), xUnit)}
              yFormat={(value) => formatMetricValue(Number(value), unit)}
              onClick={(point) => selectPointWorkload(point, onWorkloadChange)}
              markers={
                selectedInput
                  ? [
                      {
                        axis: "x",
                        value: selectedInput.x,
                        lineStyle: { stroke: "#2563eb", strokeWidth: 1.4, strokeDasharray: "4 4", opacity: 0.76 },
                      },
                    ]
                  : []
              }
              layers={["grid", "markers", "axes", trendLayer, "mesh"]}
            />
          </div>
          <div className="chart-legend">
            <div className="legend-group">
              <strong>Color</strong>
              {legendAlgorithms.map((algorithm) => (
                <button
                  key={algorithm}
                  type="button"
                  className={focusedAlgorithm === algorithm ? "active" : ""}
                  onClick={() => onFocusAlgorithm(algorithm)}
                >
                  <i style={{ background: series.find((item) => item.algorithm === algorithm)?.color ?? colorForAlgorithm(algorithm) }} />
                  <span>{algorithm}</span>
                </button>
              ))}
            </div>
            <div className="legend-group">
              <strong>Line</strong>
              {legendPlatforms.map((item) => (
                <button
                  key={item.hostId}
                  type="button"
                  className={focusedPlatform === item.hostId ? "line-style-key active" : "line-style-key"}
                  onClick={() => onFocusPlatform(item.hostId)}
                >
                  <svg viewBox="0 0 34 8" aria-hidden="true">
                    <line x1="1" x2="33" y1="4" y2="4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray={item.dash} />
                  </svg>
                  <span>{item.platform}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function RankSizePicker({
  value,
  label,
  workloads,
  onChange,
}: {
  value: string;
  label: string;
  workloads: string[];
  onChange: (workload: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [open]);

  return (
    <div
      className="rank-size-picker"
      ref={menuRef}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setOpen(false);
        }
      }}
    >
      <span>Rank size</span>
      <div className="rank-size-control">
        <button
          type="button"
          className="rank-size-trigger"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <strong>{label}</strong>
          <ChevronDown className="size-4" />
        </button>
        {open ? (
          <div className="rank-size-menu" role="group" aria-label="Rank size">
            {workloads.map((workload) => {
              const active = workload === value;
              return (
                <button
                  key={workload}
                  type="button"
                  className={active ? "rank-size-menu-item active" : "rank-size-menu-item"}
                  aria-pressed={active}
                  onClick={() => {
                    onChange(workload);
                    setOpen(false);
                  }}
                >
                  <span>{workload}</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function selectPointWorkload(
  datum: Readonly<Point<NivoTrendSeries>> | { readonly points: readonly Point<NivoTrendSeries>[] },
  onWorkloadChange: (workload: string) => void,
) {
  const point = "points" in datum ? datum.points[0] : datum;
  const label = point && typeof point.data.label === "string" ? point.data.label : "";
  if (label) {
    onWorkloadChange(label);
  }
}

function scaleSpec(mode: AxisScale, min: number | "auto" = "auto", max: number | "auto" = "auto") {
  return {
    type: mode,
    min,
    max,
  };
}

function uniqueNumbers(values: number[]) {
  return [...new Set(values.filter((value) => Number.isFinite(value) && value > 0))].sort((leftValue, rightValue) => leftValue - rightValue);
}

function sparseTicks(values: number[], maxTicks: number) {
  if (values.length <= maxTicks) {
    return values;
  }

  const ticks: number[] = [];
  for (let index = 0; index < maxTicks; index += 1) {
    const valueIndex = Math.round((index * (values.length - 1)) / (maxTicks - 1));
    ticks.push(values[valueIndex]);
  }
  return [...new Set(ticks)];
}

function paddedYDomain(values: number[], mode: AxisScale): { min: number | "auto"; max: number | "auto" } {
  if (values.length === 0) {
    return { min: mode === "linear" ? 0 : "auto", max: "auto" };
  }

  const minValue = Math.min(...values);
  if (mode === "linear") {
    return { min: 0, max: "auto" };
  }
  return { min: minValue / 1.15, max: "auto" };
}

function makeTrendLayer(
  focusedAlgorithm: string | null,
  focusedPlatform: string | null,
  representativeWorkload: string,
  onWorkloadChange: (workload: string) => void,
) {
  return function TrendLayer({ series, points, lineGenerator }: LineCustomSvgLayerProps<NivoTrendSeries>) {
    return (
      <g>
        {series.map((item) => {
          const dimmed = Boolean(
            (focusedAlgorithm && focusedAlgorithm !== item.algorithm) ||
              (focusedPlatform && focusedPlatform !== item.hostId),
          );
          const path = lineGenerator(item.data.map((point) => point.position));
          return (
            <path
              key={item.id}
              d={path ?? undefined}
              fill="none"
              stroke={item.color}
              strokeWidth={2.2}
              strokeDasharray={item.dash}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={dimmed ? 0.24 : 1}
            />
          );
        })}
        {points.map((point) => {
          const seriesItem = series.find((item) => item.id === point.seriesId);
          const dimmed = Boolean(
            seriesItem &&
              ((focusedAlgorithm && focusedAlgorithm !== seriesItem.algorithm) ||
                (focusedPlatform && focusedPlatform !== seriesItem.hostId)),
          );
          const label = typeof point.data.label === "string" ? point.data.label : "";
          const selected = label === representativeWorkload;
          return (
            <circle
              key={point.id}
              cx={point.x}
              cy={point.y}
              r={selected ? 4.2 : 3.4}
              fill={point.seriesColor}
              opacity={dimmed ? 0.24 : 1}
              stroke={selected ? "#ffffff" : "transparent"}
              strokeWidth={selected ? 1.8 : 0}
              className="trend-point"
              onClick={() => {
                if (label) {
                  onWorkloadChange(label);
                }
              }}
            />
          );
        })}
      </g>
    );
  };
}
