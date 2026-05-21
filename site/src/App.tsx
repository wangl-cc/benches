import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Cpu,
  ExternalLink,
  Gauge,
  Laptop,
  Monitor,
  Moon,
  Sun,
} from "lucide-react";
import type { Chart, Host, ResultsData, Scope, ThemePreference } from "./types";

const themeStorageKey = "benchmark-dashboard-theme";
const allHosts = "all";

export function App() {
  const [data, setData] = useState<ResultsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeScopeId, setActiveScopeId] = useState<string>("");
  const [activeHostId, setActiveHostId] = useState<string>(allHosts);
  const [theme, setTheme] = useState<ThemePreference>(() => readStoredTheme());

  useEffect(() => {
    fetch(withBase("results.json"))
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load results.json (${response.status})`);
        }
        return response.json() as Promise<ResultsData>;
      })
      .then((nextData) => {
        setData(nextData);
        setActiveScopeId(nextData.scopes[0]?.id ?? "");
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
      });
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const resolved = theme === "system" ? (media.matches ? "dark" : "light") : theme;
      document.documentElement.classList.toggle("dark", resolved === "dark");
      document.documentElement.dataset.theme = theme;
    };

    applyTheme();
    if (theme === "system") {
      media.addEventListener("change", applyTheme);
      return () => media.removeEventListener("change", applyTheme);
    }
  }, [theme]);

  const setThemePreference = (nextTheme: ThemePreference) => {
    setTheme(nextTheme);
    localStorage.setItem(themeStorageKey, nextTheme);
  };

  const activeScope = data?.scopes.find((scope) => scope.id === activeScopeId) ?? data?.scopes[0];
  const activeHost = data?.hosts.find((host) => host.id === activeHostId);
  const chartCount = data?.scopes.reduce((sum, scope) => sum + scope.charts.length, 0) ?? 0;

  if (error) {
    return (
      <Shell>
        <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-900 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-100">
          {error}
        </div>
      </Shell>
    );
  }

  if (!data || !activeScope) {
    return (
      <Shell>
        <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
          Loading benchmark results...
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <Toolbar
        hostCount={data.hosts.length}
        chartCount={chartCount}
        theme={theme}
        onThemeChange={setThemePreference}
      />
      <main className="mx-auto grid w-full max-w-7xl gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[300px_minmax(0,1fr)] lg:px-8">
        <aside className="space-y-4">
          <ScopeTabs scopes={data.scopes} activeScopeId={activeScope.id} onChange={setActiveScopeId} />
          <HostPanel
            hosts={data.hosts}
            activeHostId={activeHostId}
            activeHost={activeHost}
            onHostChange={setActiveHostId}
            generatedAt={data.generatedAt}
          />
        </aside>
        <ChartGrid scope={activeScope} hosts={data.hosts} activeHostId={activeHostId} />
      </main>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-100 text-slate-950 antialiased dark:bg-slate-950 dark:text-slate-100">
      {children}
    </div>
  );
}

function Toolbar({
  hostCount,
  chartCount,
  theme,
  onThemeChange,
}: {
  hostCount: number;
  chartCount: number;
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
}) {
  return (
    <header className="border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
            <Gauge className="size-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-normal text-slate-950 dark:text-white">
              Benchmark Dashboard
            </h1>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium text-slate-500 dark:text-slate-400">
              <span className="inline-flex items-center gap-1.5">
                <Cpu className="size-3.5" aria-hidden="true" />
                {hostCount} platforms
              </span>
              <span className="inline-flex items-center gap-1.5">
                <BarChart3 className="size-3.5" aria-hidden="true" />
                {chartCount} chart groups
              </span>
            </div>
          </div>
        </div>
        <ThemeToggle value={theme} onChange={onThemeChange} />
      </div>
    </header>
  );
}

function ThemeToggle({
  value,
  onChange,
}: {
  value: ThemePreference;
  onChange: (theme: ThemePreference) => void;
}) {
  const options: Array<{ value: ThemePreference; label: string; icon: React.ElementType }> = [
    { value: "system", label: "System", icon: Monitor },
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
  ];

  return (
    <div className="inline-flex w-full rounded-lg border border-slate-200 bg-slate-50 p-1 shadow-sm md:w-auto dark:border-slate-800 dark:bg-slate-900">
      {options.map((option) => {
        const Icon = option.icon;
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            title={option.label}
            className={[
              "inline-flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition md:flex-none",
              active
                ? "bg-white text-slate-950 shadow-sm dark:bg-slate-800 dark:text-white"
                : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100",
            ].join(" ")}
          >
            <Icon className="size-4" aria-hidden="true" />
            <span className="sm:hidden lg:inline">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function ScopeTabs({
  scopes,
  activeScopeId,
  onChange,
}: {
  scopes: Scope[];
  activeScopeId: string;
  onChange: (scopeId: string) => void;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-2 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="grid grid-cols-2 gap-2">
        {scopes.map((scope) => {
          const active = scope.id === activeScopeId;
          return (
            <button
              key={scope.id}
              type="button"
              onClick={() => onChange(scope.id)}
              className={[
                "rounded-md px-3 py-2 text-sm font-semibold transition",
                active
                  ? "bg-slate-950 text-white dark:bg-white dark:text-slate-950"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white",
              ].join(" ")}
            >
              {scope.title}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function HostPanel({
  hosts,
  activeHostId,
  activeHost,
  generatedAt,
  onHostChange,
}: {
  hosts: Host[];
  activeHostId: string;
  activeHost?: Host;
  generatedAt: string;
  onHostChange: (hostId: string) => void;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <label className="block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400" htmlFor="host">
        Platform
      </label>
      <select
        id="host"
        value={activeHostId}
        onChange={(event) => onHostChange(event.target.value)}
        className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-950 shadow-sm outline-none ring-slate-400 transition focus:ring-2 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:ring-slate-500"
      >
        <option value={allHosts}>All platforms</option>
        {hosts.map((host) => (
          <option key={host.id} value={host.id}>
            {host.title}
          </option>
        ))}
      </select>

      <div className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-800">
        {activeHost ? (
          <EnvironmentTable host={activeHost} />
        ) : (
          <div className="space-y-2">
            {hosts.map((host) => (
              <div
                key={host.id}
                className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
              >
                <div className="font-semibold text-slate-900 dark:text-white">{host.title}</div>
                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{host.environment.os}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 border-t border-slate-200 pt-4 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
        Updated {formatDate(generatedAt)}
      </div>
    </section>
  );
}

function EnvironmentTable({ host }: { host: Host }) {
  const rows = [
    ["CPU", host.environment.cpu],
    ["OS", host.environment.os],
    ["Kernel", host.environment.kernel],
    ["rustc", host.environment.rustc],
    ["LLVM", host.environment.llvm],
  ];

  return (
    <dl className="space-y-3">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">{label}</dt>
          <dd className="mt-1 break-words text-sm font-medium leading-5 text-slate-900 dark:text-slate-100">
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ChartGrid({
  scope,
  hosts,
  activeHostId,
}: {
  scope: Scope;
  hosts: Host[];
  activeHostId: string;
}) {
  const hostMap = useMemo(() => new Map(hosts.map((host) => [host.id, host])), [hosts]);
  const charts = scope.charts
    .map((chart) => ({
      ...chart,
      hosts: activeHostId === allHosts ? chart.hosts : chart.hosts.filter((host) => host.hostId === activeHostId),
    }))
    .filter((chart) => chart.hosts.length > 0);

  if (charts.length === 0) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-8 text-sm text-slate-600 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
        No charts are available for this selection.
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-950 dark:text-white">{scope.title}</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {charts.length} chart {charts.length === 1 ? "group" : "groups"}
          </p>
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {charts.flatMap((chart) =>
          chart.hosts.map((chartHost) => (
            <ChartCard key={`${chart.id}-${chartHost.hostId}`} chart={chart} host={hostMap.get(chartHost.hostId)} src={chartHost.src} />
          )),
        )}
      </div>
    </section>
  );
}

function ChartCard({ chart, host, src }: { chart: Chart; host?: Host; src: string }) {
  const href = withBase(src);

  return (
    <article className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-slate-950 dark:text-white">{chart.title}</h3>
          <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
            <Laptop className="size-3.5" aria-hidden="true" />
            {host?.title ?? "Unknown platform"}
          </p>
        </div>
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          title="Open chart"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
        >
          <ExternalLink className="size-4" aria-hidden="true" />
          <span className="sr-only">Open chart</span>
        </a>
      </div>
      <div className="bg-white p-2">
        <img className="aspect-video w-full rounded-md object-contain" src={href} alt={`${chart.title} on ${host?.title ?? "unknown platform"}`} />
      </div>
    </article>
  );
}

function readStoredTheme(): ThemePreference {
  const value = localStorage.getItem(themeStorageKey);
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

function withBase(path: string) {
  return `${import.meta.env.BASE_URL}${path}`;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
