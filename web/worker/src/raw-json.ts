import type { StoredRawBytes } from "./types.ts";

export type CompressedRawRun = {
  readonly bytes: ArrayBuffer;
  readonly originalBytes: number;
  readonly compressedBytes: number;
};

export async function compressRawRun(rawJson: string): Promise<CompressedRawRun> {
  const originalBytes = new TextEncoder().encode(rawJson).byteLength;
  const compressed = await new Response(
    new Blob([rawJson])
      .stream()
      .pipeThrough(new CompressionStream("gzip")),
  ).arrayBuffer();
  return {
    bytes: compressed,
    originalBytes,
    compressedBytes: compressed.byteLength,
  };
}

export async function decompressRawRun(gzipBytes: StoredRawBytes): Promise<string> {
  return new Response(
    new Blob([arrayBufferPart(gzipBytes)])
      .stream()
      .pipeThrough(new DecompressionStream("gzip")),
  ).text();
}

function arrayBufferPart(value: StoredRawBytes): ArrayBuffer {
  if (value instanceof ArrayBuffer) {
    return value;
  }
  if (!(value instanceof Uint8Array)) {
    return Uint8Array.from(value).buffer;
  }
  const copy: Uint8Array<ArrayBuffer> = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}
