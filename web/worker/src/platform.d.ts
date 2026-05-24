type ExportedHandler<Env> = {
  fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Response | Promise<Response>;
};

type ExecutionContext = {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
};

type D1Database = {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
};

type D1PreparedStatement = {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(column?: string): Promise<T | null>;
  all<T = unknown>(): Promise<D1Result<T>>;
  run<T = unknown>(): Promise<D1Result<T>>;
};

type D1Result<T = unknown> = {
  results?: T[];
  success: boolean;
  meta: unknown;
  error?: string;
};

type R2Bucket = {
  put(
    key: string,
    value: string | ArrayBuffer | ReadableStream,
    options?: R2PutOptions,
  ): Promise<R2Object | null>;
  get(key: string): Promise<R2ObjectBody | null>;
};

type R2PutOptions = {
  httpMetadata?: {
    contentType?: string;
  };
  customMetadata?: Record<string, string>;
};

type R2Object = {
  key: string;
};

type R2ObjectBody = {
  key: string;
  body: ReadableStream;
  text(): Promise<string>;
  writeHttpMetadata(headers: Headers): void;
};
