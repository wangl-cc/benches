export type ThemePreference = "system" | "light" | "dark";

export type Environment = {
  cpu: string;
  os: string;
  kernel: string;
  rustc: string;
  llvm: string;
};

export type Host = {
  id: string;
  title: string;
  environment: Environment;
};

export type ChartHost = {
  hostId: string;
  src: string;
};

export type Chart = {
  id: string;
  title: string;
  hosts: ChartHost[];
};

export type Scope = {
  id: string;
  title: string;
  charts: Chart[];
};

export type ResultsData = {
  generatedAt: string;
  hosts: Host[];
  scopes: Scope[];
};
