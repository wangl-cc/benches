import { ResponsiveLine } from "@nivo/line";
import type { LineCustomSvgLayerProps } from "@nivo/line";
import { LineChart } from "lucide-react";
import { useMemo } from "react";
import { colorForAlgorithm } from "../colors";
import { commonInputUnit, formatInputValue, formatMetricValue } from "../format";
import { AUTO_BENCHMARK } from "../model";
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
const MAX_Y_TICKS = 7;
const LOG_TICK_MANTISSAS = [1, 2, 5] as const;

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
  const selectedInput = selectableInputs.find((input) => input.label === representativeBenchmark);
  const activeRankLabel = activeBenchmark.startsWith(AUTO_BENCHMARK) ? `Auto: ${representativeBenchmark}` : representativeBenchmark;
  const xValues = uniqueNumbers(allPoints.map((point) => point.x));
  const yValues = uniqueNumbers(allPoints.map((point) => point.y));
  const xTickValues = sparseTicks(xValues, MAX_X_TICKS);
  const yTickValues = axisTicks(yValues, yScaleMode, MAX_Y_TICKS);
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
    () => makeTrendLayer(focusedAlgorithm, focusedPlatform),
    [focusedAlgorithm, focusedPlatform],
  );

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
          <div className="trend-chart" role="img" aria-label="Input size trend line chart">
            <ResponsiveLine<NivoTrendSeries>
              data={chartData}
              theme={benchmarkChartTheme}
              margin={{ top: 26, right: 18, bottom: 43, left: 70 }}
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
                tickValues: yTickValues,
                format: (value) => formatMetricValue(Number(value), unit),
              }}
              colors={(item) => item.color}
              curve="linear"
              enableGridX={false}
              enableGridY
              enablePoints={false}
              enableSlices={false}
              useMesh
              onClick={(datum) => {
                if ("data" in datum) {
                  onBenchmarkChange(datum.data.label);
                }
              }}
              animate={false}
              lineWidth={2.2}
              xFormat={(value) => formatInputValue(Number(value), xUnit)}
              yFormat={(value) => formatMetricValue(Number(value), unit)}
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

function axisTicks(values: number[], mode: AxisScale, maxTicks: number) {
  if (mode === "linear") {
    return linearTicks(values, maxTicks);
  }
  return logTicks(values, maxTicks);
}

function linearTicks(values: number[], maxTicks: number) {
  if (values.length === 0) {
    return [];
  }

  const maxValue = Math.max(...values);
  const paddedMax = maxValue * 1.08;
  const tickCount = Math.max(2, maxTicks);
  return Array.from({ length: tickCount }, (_, index) => (paddedMax * index) / (tickCount - 1));
}

function logTicks(values: number[], maxTicks: number) {
  if (values.length === 0) {
    return [];
  }

  const minValue = Math.min(...values);
  const maxValue = Math.max(...values) * 1.15;
  const minExponent = Math.floor(Math.log10(minValue));
  const maxExponent = Math.ceil(Math.log10(maxValue));
  const candidates: number[] = [];

  for (let exponent = minExponent; exponent <= maxExponent; exponent += 1) {
    const magnitude = 10 ** exponent;
    for (const mantissa of LOG_TICK_MANTISSAS) {
      const value = mantissa * magnitude;
      if (value >= minValue && value <= maxValue) {
        candidates.push(value);
      }
    }
  }

  return sparseTicks(candidates, maxTicks);
}

function paddedYDomain(values: number[], mode: AxisScale): { min: number | "auto"; max: number | "auto" } {
  if (values.length === 0) {
    return { min: mode === "linear" ? 0 : "auto", max: "auto" };
  }

  const maxValue = Math.max(...values);
  if (mode === "linear") {
    return { min: 0, max: maxValue * 1.08 };
  }
  return { min: "auto", max: maxValue * 1.15 };
}

function makeTrendLayer(focusedAlgorithm: string | null, focusedPlatform: string | null) {
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
          return <circle key={point.id} cx={point.x} cy={point.y} r="3.4" fill={point.seriesColor} opacity={dimmed ? 0.24 : 1} />;
        })}
      </g>
    );
  };
}
