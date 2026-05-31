import type { ElementType, ReactNode } from "react";
import { Activity, BarChart3, Cpu, RotateCcw, Search, Sigma } from "lucide-react";
import { colorForAlgorithm } from "../colors";
import type { ExplorerData } from "../types";
import { labelize } from "../utils";

export function LeftRail({
  source,
  apiError,
  benchmarkNames,
  groups,
  algorithms,
  algorithmColors,
  selectedAlgorithms,
  activeBenchmarkName,
  activeGroup,
  query,
  visibleCount,
  onBenchmarkNameChange,
  onGroupChange,
  onAlgorithmToggle,
  onClearAlgorithms,
  onQueryChange,
  onReset,
}: {
  source: ExplorerData["source"];
  apiError: string | null;
  benchmarkNames: string[];
  groups: string[];
  algorithms: string[];
  algorithmColors: Map<string, string>;
  selectedAlgorithms: string[];
  activeBenchmarkName: string;
  activeGroup: string;
  query: string;
  visibleCount: number;
  onBenchmarkNameChange: (benchmarkName: string) => void;
  onGroupChange: (group: string) => void;
  onAlgorithmToggle: (algorithm: string) => void;
  onClearAlgorithms: () => void;
  onQueryChange: (query: string) => void;
  onReset: () => void;
}) {
  return (
    <aside className="left-rail">
      <div className="brand-block">
        <div className="brand-mark">
          <Sigma className="size-5" />
        </div>
        <div>
          <h1>Benchmark Explorer</h1>
          <p title={apiError ?? undefined}>{source === "api" ? "Analysis Console" : "API fallback fixture"}</p>
        </div>
      </div>

      <RailSection title="Benchmark" icon={BarChart3}>
        <OptionList values={benchmarkNames} activeValue={activeBenchmarkName} onChange={onBenchmarkNameChange} />
      </RailSection>

      <RailSection title="Group" icon={Cpu}>
        <OptionList values={groups} activeValue={activeGroup} onChange={onGroupChange} />
      </RailSection>

      <RailSection title="Algorithms" icon={Activity} detail={`${selectedAlgorithms.length} selected`}>
        <div className="algorithm-list">
          {algorithms.map((algorithm) => (
            <button
              key={algorithm}
              type="button"
              className={selectedAlgorithms.includes(algorithm) ? "check-row active" : "check-row"}
              aria-pressed={selectedAlgorithms.includes(algorithm)}
              onClick={() => onAlgorithmToggle(algorithm)}
            >
              <span className="check-box">{selectedAlgorithms.includes(algorithm) ? "✓" : ""}</span>
              <i style={{ background: colorForAlgorithm(algorithm, algorithmColors.get(algorithm)) }} />
              <span>{algorithm}</span>
            </button>
          ))}
          <button type="button" className="rail-link" onClick={onClearAlgorithms}>
            Select all algorithms
          </button>
        </div>
      </RailSection>

      <RailSection title="Search" icon={Search}>
        <label className="rail-search">
          <Search className="size-4" />
          <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Filter algorithms..." />
        </label>
        <p className="rail-count">{visibleCount} visible rows</p>
      </RailSection>

      <button type="button" className="reset-button" onClick={onReset}>
        <RotateCcw className="size-4" />
        Reset filters
      </button>
    </aside>
  );
}

function RailSection({
  title,
  icon: Icon,
  detail,
  children,
}: {
  title: string;
  icon: ElementType;
  detail?: string;
  children: ReactNode;
}) {
  return (
    <section className="rail-section">
      <div className="rail-heading">
        <span>
          <Icon className="size-4" />
          {title}
        </span>
        {detail ? <small>{detail}</small> : null}
      </div>
      {children}
    </section>
  );
}

function OptionList({
  values,
  activeValue,
  onChange,
}: {
  values: string[];
  activeValue: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="rail-options" role="radiogroup">
      {values.map((value) => (
        <button
          key={value}
          type="button"
          className={value === activeValue ? "rail-option active" : "rail-option"}
          role="radio"
          aria-checked={value === activeValue}
          onClick={() => onChange(value)}
        >
          <span>{labelize(value)}</span>
        </button>
      ))}
    </div>
  );
}
