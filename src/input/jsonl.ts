import { lines } from "./lines"

/**
 * Open a file path as a `ReadableStream<Uint8Array>`. If the path ends in
 * `.gz` or `.gzip`, transparently pipe through a gzip `DecompressionStream`.
 */
export function openSource(path: string): ReadableStream<Uint8Array> {
  const f = Bun.file(path)
  let s: ReadableStream<Uint8Array> = f.stream()
  if (path.endsWith(".gz") || path.endsWith(".gzip")) {
    // @ts-expect-error - DecompressionStream typing mismatch (BufferSource vs Uint8Array)
    s = s.pipeThrough(new DecompressionStream("gzip"))
  }
  return s
}

/**
 * Parse a JSONL stream into a list of values. Bad lines log to stderr and are
 * skipped. The label is used for parse-error messages only.
 */
export async function parseJsonl(stream: ReadableStream<Uint8Array>, label: string): Promise<unknown[]> {
  const out: unknown[] = []
  let n = 0
  for await (const raw of lines(stream)) {
    const line = raw.trim()
    if (!line) continue
    n++
    try {
      out.push(JSON.parse(line))
    } catch (e) {
      console.error(`[${label}:${n}] JSON parse error: ${(e as Error).message}`)
    }
  }
  return out
}
