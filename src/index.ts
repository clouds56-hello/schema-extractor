import { runAdapters } from "./adapters/index"
import type { ExtractorOptions } from "./config"
import { resolveOptions } from "./config"
import { dedupeDecls } from "./emit/dedupe"
import { buildDocument } from "./emit/document"
import { makeEmitCtx, render } from "./emit/render"
import { expandGlobs } from "./input/glob"
import { openSource, parseJsonl } from "./input/jsonl"
import { fromValue } from "./ir/from-value"
import { merge } from "./ir/merge"
import type { Schema } from "./ir/types"
import { NEVER } from "./ir/types"
import { parseDts } from "./parse-dts/index"
import { runPipeline } from "./passes/pipeline"
import { runtime } from "./runtime"

export type { Adapter } from "./adapters/index"
export { codexRolloutAdapter, DEFAULT_ADAPTERS, vscodePatchAdapter } from "./adapters/index"
export type { ExtractorOptions } from "./config"
export type { Schema } from "./ir/types"

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

/**
 * Re-emit a `.d.ts` document after running the simplification pipeline on a
 * previously generated schema. Useful for cleaning hand-written or stale
 * declarations.
 *
 * The input must conform to the narrow grammar emitted by this library.
 * The last `export type` declaration in the file is treated as the root
 * unless `opts.rootName` matches an earlier decl by name.
 */
export function simplifyDts(source: string, opts: ExtractorOptions = {}): string {
  const { decls, order } = parseDts(source)
  if (decls.length === 0) throw new Error("simplify: no `export type` declarations found")
  const requested = opts.rootName
  let rootIdx = decls.length - 1
  if (requested) {
    const found = decls.findIndex((d) => d.name === requested)
    if (found >= 0) rootIdx = found
  }
  const rootDecl = decls[rootIdx]!
  const merged: ExtractorOptions = { ...opts, rootName: rootDecl.name }
  const resolved = resolveOptions(merged)
  void order
  return emitDocument(rootDecl.schema, resolved)
}
