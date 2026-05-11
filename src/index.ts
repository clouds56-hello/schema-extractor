import type { Schema } from "./ir/types"
import { NEVER } from "./ir/types"
import { merge } from "./ir/merge"
import { fromValue } from "./ir/from-value"
import { runPipeline } from "./passes/pipeline"
import { makeEmitCtx, render } from "./emit/render"
import { dedupeDecls } from "./emit/dedupe"
import { buildDocument } from "./emit/document"
import { runtime } from "./runtime"
import { runAdapters } from "./adapters/index"
import { openSource, parseJsonl } from "./input/jsonl"
import { expandGlobs } from "./input/glob"
import type { ExtractorOptions } from "./config"
import { resolveOptions } from "./config"

export type { ExtractorOptions } from "./config"
export type { Schema } from "./ir/types"
export type { Adapter } from "./adapters/index"
export { DEFAULT_ADAPTERS, vscodePatchAdapter, codexRolloutAdapter } from "./adapters/index"

/** Run the full pipeline on an in-memory IR and emit a TypeScript document. */
function emitDocument(root: Schema, opts: ReturnType<typeof resolveOptions>): string {
  const piped = runPipeline(root, {
    rootName: opts.rootName,
    recordHints: opts.recordHints,
    dedupHints: opts.dedupHints,
    multiTagHints: opts.multiTagHints,
  })
  const ctx = makeEmitCtx([opts.rootName])
  ctx.hoistedSet = piped.hoistedSet
  ctx.hoistName = piped.hoistNames
  const renderedRaw = render(piped.root, ctx, { old: opts.rootName, pretty: "", field: "" })
  const after = dedupeDecls(ctx.decls, renderedRaw)
  return buildDocument({
    ctx,
    decls: after.decls,
    rootName: opts.rootName,
    renderedRoot: after.root,
    header: opts.header,
  })
}

/**
 * Extract a `.d.ts` document from an in-memory iterable of parsed JSON values.
 * Adapters are NOT consulted (they only fire on JSONL file ingest).
 */
export function extractSchema(values: Iterable<unknown>, opts: ExtractorOptions = {}): string {
  const resolved = resolveOptions(opts)
  const prevTag = runtime.userTagKey
  runtime.userTagKey = resolved.userTagKey
  try {
    let schema: Schema = NEVER
    for (const v of values) schema = merge(schema, fromValue(v))
    return emitDocument(schema, resolved)
  } finally {
    runtime.userTagKey = prevTag
  }
}

/**
 * Extract a `.d.ts` from a single JSONL stream. Adapters are consulted on the
 * full parsed-record batch.
 */
export async function extractSchemaFromStream(
  stream: ReadableStream<Uint8Array>,
  opts: ExtractorOptions = {},
  label = "<stream>",
): Promise<string> {
  const resolved = resolveOptions(opts)
  const prevTag = runtime.userTagKey
  runtime.userTagKey = resolved.userTagKey
  try {
    const records = await parseJsonl(stream, label)
    const schema = runAdapters(records, resolved.adapters)
    return emitDocument(schema, resolved)
  } finally {
    runtime.userTagKey = prevTag
  }
}

/**
 * Extract a `.d.ts` from one or more JSONL files (globs and `~` allowed).
 * Each file is fed through the adapter chain independently and merged into
 * a shared root schema.
 */
export async function extractSchemaFromFiles(
  patterns: readonly string[],
  opts: ExtractorOptions = {},
): Promise<string> {
  const resolved = resolveOptions(opts)
  const prevTag = runtime.userTagKey
  runtime.userTagKey = resolved.userTagKey
  try {
    const files = expandGlobs(patterns)
    if (files.length === 0) throw new Error("no input files matched")
    let schema: Schema = NEVER
    for (const f of files) {
      const records = await parseJsonl(openSource(f), f)
      schema = merge(schema, runAdapters(records, resolved.adapters))
      console.error(`[${f}] processed ${records.length} records`)
    }
    return emitDocument(schema, resolved)
  } finally {
    runtime.userTagKey = prevTag
  }
}
