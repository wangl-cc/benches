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
  const [scope, setScope] = useState("");
  const [group, setGroup] = useState("");
  const [benchmark, setBenchmark] = useState("");
  const [query, setQuery] = useState("");
  const [platformIds, setPlatformIds] = useState<string[]>([]);
  const [algorithmIds, setAlgorithmIds] = useState<string[]>([]);
  const [focusedAlgorithm, setFocusedAlgorithm] = useState<string | null>(null);
  const [focusedPlatform, setFocusedPlatform] = useState<string | null>(null);
  const [trendXScale, setTrendXScale] = useState<AxisScale>("log");
  const [trendYScale, setTrendYScale] = useState<AxisScale>("log");
  const [rankingGroup, setRankingGroup] = useState<RankingGroup>("algorithm");
  const [tailMetric, setTailMetric] = useState<TailLatencyMetric>("p95");

  useEffect(() => {
    loadExplorerData()
      .then((nextData) => {
        setData(nextData);
        const defaults = deriveDefaults(nextData);
        setScope(defaults.scope);
        setGroup(defaults.group);
        setBenchmark(defaults.benchmark);
        setPlatformIds(defaults.platformIds);
        setAlgorithmIds(defaults.algorithmIds);
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
        const fallback = fixtureData();
        setData(fallback);
        const defaults = deriveDefaults(fallback);
        setScope(defaults.scope);
        setGroup(defaults.group);
        setBenchmark(defaults.benchmark);
        setPlatformIds(defaults.platformIds);
        setAlgorithmIds(defaults.algorithmIds);
      });
  }, []);

  const model = useMemo(() => {
    if (!data) {
      return null;
    }
    return buildExplorerModel(data, {
      scope,
      group,
      benchmark,
      query,
      platformIds,
      algorithmIds,
      rankingGroup,
    });
  }, [algorithmIds, benchmark, data, group, rankingGroup, platformIds, query, scope]);

  useEffect(() => {
    if (!model) {
      return;
    }
    if (!model.scopes.includes(scope)) {
      setScope(model.scopes[0] ?? "");
    }
    if (!model.groups.includes(group)) {
      setGroup(model.groups[0] ?? "");
    }
    if (!model.benchmarks.includes(benchmark)) {
      setBenchmark(model.benchmarks[0] ?? "");
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
  }, [algorithmIds, benchmark, focusedAlgorithm, focusedPlatform, group, model, platformIds, scope]);

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
          scopes={model.scopes}
          groups={model.groups}
          algorithms={model.availableAlgorithms}
          algorithmColors={model.algorithmColors}
          selectedAlgorithms={algorithmIds}
          activeScope={scope}
          activeGroup={group}
          query={query}
          visibleCount={model.visibleRows.length}
          onScopeChange={setScope}
          onGroupChange={setGroup}
          onAlgorithmToggle={(algorithm) => setAlgorithmIds(toggleValue(algorithmIds, algorithm))}
          onClearAlgorithms={() => setAlgorithmIds(model.availableAlgorithms.slice(0, 4))}
          onQueryChange={setQuery}
          onReset={() => {
            const defaults = deriveDefaults(data);
            setScope(defaults.scope);
            setGroup(defaults.group);
            setBenchmark(defaults.benchmark);
            setPlatformIds(defaults.platformIds);
            setAlgorithmIds(defaults.algorithmIds);
            setQuery("");
            setFocusedAlgorithm(null);
            setFocusedPlatform(null);
          }}
        />
        <main className="workspace">
          <ComparisonBar
            title={`${labelize(group || scope)} Comparison`}
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
              activeBenchmark={benchmark}
              representativeBenchmark={model.representativeBenchmark}
              autoBenchmark={model.autoBenchmark}
              focusedAlgorithm={activeAlgorithm}
              focusedPlatform={focusedPlatform}
              onFocusAlgorithm={toggleFocusedAlgorithm}
              onFocusPlatform={toggleFocusedPlatform}
              onBenchmarkChange={setBenchmark}
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
