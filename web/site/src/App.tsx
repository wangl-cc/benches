import { useEffect, useMemo, useState } from "react";
import { Activity } from "lucide-react";
import { ComparisonBar } from "./components/ComparisonBar";
import { LeftRail } from "./components/LeftRail";
import { PerformanceRankingChart, StabilityPanel, TailLatencyPanel } from "./components/RankingPanels";
import { TrendChart } from "./components/TrendChart";
import { loadExplorerData } from "./data";
import { fixtureData } from "./fixtures";
import {
  buildExplorerModel,
  deriveDefaults,
} from "./model";
import type {
  AxisScale,
  ExplorerData,
  RankingGroup,
  TailLatencyMetric,
} from "./types";
import { labelize, toggleValue } from "./utils";

export function App() {
  const [data, setData] = useState<ExplorerData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [benchmarkName, setBenchmarkName] = useState("");
  const [group, setGroup] = useState("");
  const [workload, setWorkload] = useState("");
  const [query, setQuery] = useState("");
  const [platformIds, setPlatformIds] = useState<string[]>([]);
  const [algorithmIds, setAlgorithmIds] = useState<string[]>([]);
  const [focusedAlgorithm, setFocusedAlgorithm] = useState<string | null>(null);
  const [focusedPlatform, setFocusedPlatform] = useState<string | null>(null);
  const [trendXScale, setTrendXScale] = useState<AxisScale>("log");
  const [trendYScale, setTrendYScale] = useState<AxisScale>("linear");
  const [rankingGroup, setRankingGroup] = useState<RankingGroup>("algorithm");
  const [tailMetric, setTailMetric] = useState<TailLatencyMetric>("p95");

  useEffect(() => {
    loadExplorerData()
      .then((nextData) => {
        setData(nextData);
        const defaults = deriveDefaults(nextData);
        setBenchmarkName(defaults.benchmarkName);
        setGroup(defaults.group);
        setWorkload(defaults.workload);
        setPlatformIds(defaults.platformIds);
        setAlgorithmIds(defaults.algorithmIds);
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
        const fallback = fixtureData();
        setData(fallback);
        const defaults = deriveDefaults(fallback);
        setBenchmarkName(defaults.benchmarkName);
        setGroup(defaults.group);
        setWorkload(defaults.workload);
        setPlatformIds(defaults.platformIds);
        setAlgorithmIds(defaults.algorithmIds);
      });
  }, []);

  const model = useMemo(() => {
    if (!data) {
      return null;
    }
    return buildExplorerModel(data, {
      benchmarkName,
      group,
      workload,
      query,
      platformIds,
      algorithmIds,
      rankingGroup,
    });
  }, [algorithmIds, workload, data, group, rankingGroup, platformIds, query, benchmarkName]);

  useEffect(() => {
    if (!model) {
      return;
    }
    if (!model.benchmarkNames.includes(benchmarkName)) {
      setBenchmarkName(model.benchmarkNames[0] ?? "");
    }
    if (!model.groups.includes(group)) {
      setGroup(model.groups[0] ?? "");
    }
    if (!model.workloads.includes(workload)) {
      setWorkload(model.workloads[0] ?? "");
    }
    if (!sameSelection(platformIds, model.selectedHostIds)) {
      setPlatformIds(model.selectedHostIds);
    }
    if (!sameSelection(algorithmIds, model.selectedAlgorithms)) {
      setAlgorithmIds(model.selectedAlgorithms);
    }
    if (focusedAlgorithm && !model.availableAlgorithms.includes(focusedAlgorithm)) {
      setFocusedAlgorithm(null);
    }
    if (focusedPlatform && !model.selectedHostIds.includes(focusedPlatform)) {
      setFocusedPlatform(null);
    }
  }, [algorithmIds, workload, focusedAlgorithm, focusedPlatform, group, model, platformIds, benchmarkName]);

  if (!data || !model) {
    return (
      <Shell>
        <LoadingState />
      </Shell>
    );
  }

  const activeAlgorithm = focusedAlgorithm;
  const toggleFocusedAlgorithm = (algorithm: string) => {
    setFocusedAlgorithm((current) => (current === algorithm ? null : algorithm));
  };
  const toggleFocusedPlatform = (hostId: string) => {
    setFocusedPlatform((current) => (current === hostId ? null : hostId));
  };
  return (
    <Shell>
      <div className="app-shell">
        <LeftRail
          source={data.source}
          apiError={error}
          benchmarkNames={model.benchmarkNames}
          groups={model.groups}
          algorithms={model.visibleAlgorithms}
          algorithmColors={model.algorithmColors}
          selectedAlgorithms={algorithmIds}
          activeBenchmarkName={benchmarkName}
          activeGroup={group}
          query={query}
          visibleCount={model.visibleRows.length}
          onBenchmarkNameChange={setBenchmarkName}
          onGroupChange={setGroup}
          onAlgorithmToggle={(algorithm) => setAlgorithmIds(toggleValue(algorithmIds, algorithm))}
          onClearAlgorithms={() => setAlgorithmIds(model.availableAlgorithms)}
          onQueryChange={setQuery}
          onReset={() => {
            const defaults = deriveDefaults(data);
            setBenchmarkName(defaults.benchmarkName);
            setGroup(defaults.group);
            setWorkload(defaults.workload);
            setPlatformIds(defaults.platformIds);
            setAlgorithmIds(defaults.algorithmIds);
            setQuery("");
            setFocusedAlgorithm(null);
            setFocusedPlatform(null);
          }}
        />
        <main className="workspace">
          <ComparisonBar
            title={`${labelize(group || benchmarkName)} Comparison`}
            description={model.workloadDescription}
            hosts={model.hosts}
            selectedHostIds={platformIds}
            onHostToggle={(hostId) => setPlatformIds(toggleValue(platformIds, hostId))}
          />
          <section className="hero-grid">
            <TrendChart
              series={model.trendSeries}
              unit={model.unit}
              xScaleMode={trendXScale}
              yScaleMode={trendYScale}
              activeWorkload={workload}
              representativeWorkload={model.representativeWorkload}
              autoWorkload={model.autoWorkload}
              workloads={model.workloads}
              focusedAlgorithm={activeAlgorithm}
              focusedPlatform={focusedPlatform}
              onFocusAlgorithm={toggleFocusedAlgorithm}
              onFocusPlatform={toggleFocusedPlatform}
              onWorkloadChange={setWorkload}
              onXScaleChange={setTrendXScale}
              onYScaleChange={setTrendYScale}
            />
          </section>
          <section className="rank-grid">
            <PerformanceRankingChart
              rows={model.visibleRows}
              groups={model.rankingGroups}
              groupMode={rankingGroup}
              focusedAlgorithm={activeAlgorithm}
              focusedPlatform={focusedPlatform}
              onGroupModeChange={setRankingGroup}
              onFocusAlgorithm={toggleFocusedAlgorithm}
              onFocusPlatform={toggleFocusedPlatform}
            />
            <TailLatencyPanel
              rows={model.visibleRows}
              tailMetric={tailMetric}
              groupMode={rankingGroup}
              focusedAlgorithm={activeAlgorithm}
              focusedPlatform={focusedPlatform}
              onTailMetricChange={setTailMetric}
              onFocusAlgorithm={toggleFocusedAlgorithm}
              onFocusPlatform={toggleFocusedPlatform}
            />
            <StabilityPanel
              rows={model.visibleRows}
              groupMode={rankingGroup}
              focusedAlgorithm={activeAlgorithm}
              focusedPlatform={focusedPlatform}
              onFocusAlgorithm={toggleFocusedAlgorithm}
              onFocusPlatform={toggleFocusedPlatform}
            />
          </section>
        </main>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="app-root">{children}</div>;
}

function LoadingState() {
  return (
    <div className="loading-wrap">
      <div className="panel loading-panel">
        <Activity className="size-5" />
        <div>
          <h1>Loading benchmark explorer</h1>
          <p>Fetching /api/runs and /api/results.</p>
        </div>
      </div>
    </div>
  );
}

function sameSelection(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
