declare const process: {
  readonly env: Record<string, string | undefined>;
  readonly argv: readonly string[];
  readonly stdin: { readonly isTTY?: boolean };
  readonly stdout: {
    readonly isTTY?: boolean;
    write(text: string): void;
  };
  cwd(): string;
  chdir(directory: string): void;
  exitCode?: number;
};

declare module "node:crypto" {
  export const webcrypto: Crypto;
}

declare module "node:fs/promises" {
  export function readFile(path: string, encoding: "utf8"): Promise<string>;
  export function writeFile(path: string, data: string, encoding: "utf8"): Promise<void>;
  export function mkdir(path: string, options?: { readonly recursive?: boolean }): Promise<void>;
  export function chmod(path: string, mode: number): Promise<void>;
  export function unlink(path: string): Promise<void>;
}

declare module "node:child_process" {
  export function spawnSync(
    command: string,
    args: readonly string[],
    options?: {
      readonly cwd?: string;
      readonly env?: Record<string, string | undefined>;
      readonly stdio?: "inherit" | "pipe";
      readonly encoding?: "utf8";
      readonly timeout?: number;
    },
  ): {
    readonly error?: Error;
    readonly status: number | null;
    readonly stdout?: string;
    readonly stderr?: string;
  };
}

declare module "node:os" {
  export function homedir(): string;
  export function platform(): string;
}

declare module "node:readline/promises" {
  export function createInterface(options: {
    readonly input: unknown;
    readonly output: unknown;
  }): {
    question(prompt: string): Promise<string>;
    close(): void;
  };
}

declare module "node:url" {
  export function fileURLToPath(url: URL): string;
}

declare module "node:test" {
  export function test(
    name: string,
    fn: () => void | Promise<void>,
  ): void;
}

declare module "node:assert/strict" {
  export function equal(actual: unknown, expected: unknown): void;
  export function match(actual: string, expected: RegExp): void;
}
