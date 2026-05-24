import { AxisBottom, AxisLeft } from "@visx/axis";
import { Group } from "@visx/group";
import { scaleLinear, scaleLog } from "@visx/scale";
import { LinePath } from "@visx/shape";
import { LineChart } from "lucide-react";
import { colorForAlgorithm } from "../colors";
import { commonInputUnit, formatInputValue, formatMetricValue } from "../format";
import { AUTO_BENCHMARK } from "../model";
import type { AxisScale, TrendSeries } from "../types";
import { uniqueBy, uniqueSorted } from "../utils";
import { ControlGroup, EmptyPanel, PanelHeader, SegmentedControl } from "./common";

export function TrendChart({
  series,
  unit,
  xScaleMode,
  yScaleMode,
  activeBenchmark,
  representativeBenchmark,
  autoBenchmark,
  focusedAlgorithm,
  focusedPlatform,
  onFocusAlgorithm,
  onFocusPlatform,
  onBenchmarkChange,
  onXScaleChange,
  onYScaleChange,
}: {
  series: TrendSeries[];
  unit: string;
  xScaleMode: AxisScale;
  yScaleMode: AxisScale;
  activeBenchmark: string;
  representativeBenchmark: string;
  autoBenchmark: string;
  focusedAlgorithm: string | null;
  focusedPlatform: string | null;
  onFocusAlgorithm: (algorithm: string) => void;
  onFocusPlatform: (hostId: string) => void;
  onBenchmarkChange: (benchmark: string) => void;
  onXScaleChange: (scale: AxisScale) => void;
  onYScaleChange: (scale: AxisScale) => void;
}) {
  const width = 1120;
  const height = 318;
  const left = 76;
  const right = 36;
  const top = 28;
  const bottom = 52;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const allPoints = series.flatMap((item) => item.points);
  const minX = allPoints.length > 0 ? Math.min(...allPoints.map((point) => point.x)) : 1;
  const maxX = allPoints.length > 0 ? Math.max(...allPoints.map((point) => point.x)) : 2;
  const positiveY = allPoints.map((point) => point.y).filter((value) => value > 0);
  const minY = positiveY.length > 0 ? Math.min(...positiveY) : 1;
  const maxY = positiveY.length > 0 ? Math.max(...positiveY) : 1;
  const xScale = makeScale(xScaleMode, minX, maxX, [0, plotWidth]);
  const yMin = yScaleMode === "log" ? minY * 0.82 : 0;
  const yMax = maxY * 1.12;
  const yScale = makeScale(yScaleMode, yMin, yMax, [plotHeight, 0]);
  const yTicks = scaleTicks(yScaleMode, minY, maxY, 5);
  const xTicks = scaleTicks(xScaleMode, minX, maxX, 7);
  const xUnit = commonInputUnit(allPoints);
  const legendAlgorithms = uniqueSorted(series.map((item) => item.algorithm));
  const legendPlatforms = uniqueBy(series, (item) => item.hostId).map((item) => ({
    hostId: item.hostId,
    platform: item.platform,
    dash: item.dash,
  }));
  const selectableInputs = uniqueBy(
    allPoints
      .map((point) => ({ label: point.label, x: point.x }))
      .sort((leftPoint, rightPoint) => leftPoint.x - rightPoint.x),
    (point) => point.label,
  );
  const selectedInput = selectableInputs.find((input) => input.label === representativeBenchmark);
  const activeRankLabel = activeBenchmark.startsWith(AUTO_BENCHMARK) ? `Auto: ${representativeBenchmark}` : representativeBenchmark;
  const xPositions = selectableInputs.map((input) => xScale(input.x) ?? 0);
  const inputZones = selectableInputs.map((input, index) => {
    const current = xPositions[index] ?? 0;
    const previous = xPositions[index - 1];
    const next = xPositions[index + 1];
    const start = previous === undefined ? 0 : (previous + current) / 2;
    const end = next === undefined ? plotWidth : (current + next) / 2;
    return { ...input, x: current, start, width: Math.max(8, end - start) };
  });

  return (
    <section className="panel trend-panel">
      <PanelHeader
        icon={LineChart}
        title="Throughput vs Input Size"
        controls={
          <>
            <ControlGroup label="Rank size">
              <button
                type="button"
                className={activeBenchmark.startsWith(AUTO_BENCHMARK) ? "chart-chip active" : "chart-chip"}
                onClick={() => onBenchmarkChange(autoBenchmark)}
              >
                {activeRankLabel}
              </button>
            </ControlGroup>
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
          <svg className="trend-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Input size trend line chart">
            <Group left={left} top={top}>
              <AxisLeft
                scale={yScale}
                tickValues={yTicks}
                tickFormat={(value) => formatMetricValue(Number(value), unit)}
                stroke="#cbd5e1"
                tickStroke="#dbe3ee"
                tickLabelProps={() => ({ className: "axis-label", dx: -8, dy: "0.33em", textAnchor: "end" })}
              />
              <AxisBottom
                top={plotHeight}
                scale={xScale}
                tickValues={xTicks}
                tickFormat={(value) => formatInputValue(Number(value), xUnit)}
                stroke="#cbd5e1"
                tickStroke="#dbe3ee"
                tickLabelProps={() => ({ className: "axis-label", dy: 18, textAnchor: "middle" })}
              />
              {yTicks.map((tick) => (
                <line key={tick} x1={0} x2={plotWidth} y1={yScale(tick)} y2={yScale(tick)} className="chart-grid-line" />
              ))}
              {selectedInput ? (
                <line
                  x1={xScale(selectedInput.x)}
                  x2={xScale(selectedInput.x)}
                  y1={0}
                  y2={plotHeight}
                  className="selected-size-line"
                />
              ) : null}
              {inputZones.map((input) => (
                <g
                  key={input.label}
                  className="size-hit-zone"
                  role="button"
                  tabIndex={0}
                  onClick={() => onBenchmarkChange(input.label)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      onBenchmarkChange(input.label);
                    }
                  }}
                >
                  <rect x={input.start} y={0} width={input.width} height={plotHeight + 34}>
                    <title>{`Use ${input.label} for performance ranking`}</title>
                  </rect>
                </g>
              ))}
              {series.map((item) => {
                const dimmed = Boolean(
                  (focusedAlgorithm && focusedAlgorithm !== item.algorithm) ||
                    (focusedPlatform && focusedPlatform !== item.hostId),
                );
                return (
                  <g key={item.id} className={dimmed ? "chart-series dimmed" : "chart-series"}>
                    <LinePath
                      data={[...item.points].sort((a, b) => a.x - b.x)}
                      x={(point) => xScale(point.x) ?? 0}
                      y={(point) => yScale(Math.max(point.y, minY)) ?? 0}
                      fill="none"
                      stroke={item.color}
                      strokeWidth={2.2}
                      strokeDasharray={item.dash}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                    {item.points.map((point) => (
                      <circle
                        key={`${item.id}-${point.x}`}
                        cx={xScale(point.x)}
                        cy={yScale(Math.max(point.y, minY))}
                        r="3.4"
                        fill={item.color}
                        onClick={(event) => {
                          event.stopPropagation();
                          onBenchmarkChange(point.label);
                        }}
                      >
                        <title>{`${item.algorithm} on ${item.platform}: ${formatMetricValue(point.y, unit)}`}</title>
                      </circle>
                    ))}
                  </g>
                );
              })}
            </Group>
          </svg>
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

function makeScale(mode: AxisScale, min: number, max: number, range: [number, number]) {
  if (mode === "log") {
    return scaleLog({ domain: [Math.max(1, min), Math.max(2, max)], range });
  }
  return scaleLinear({ domain: [min, max], nice: true, range });
}

function scaleTicks(mode: AxisScale, min: number, max: number, count: number) {
  if (mode === "linear") {
    return scaleLinear({ domain: [min, max], nice: true }).ticks(count);
  }
  const start = Math.max(1, min);
  const end = Math.max(start + 1, max);
  const logMin = Math.floor(Math.log2(start));
  const logMax = Math.ceil(Math.log2(end));
  const step = Math.max(1, Math.ceil((logMax - logMin) / count));
  return Array.from({ length: Math.floor((logMax - logMin) / step) + 1 }, (_, index) => 2 ** (logMin + index * step)).filter(
    (tick) => tick >= start && tick <= end,
  );
}
