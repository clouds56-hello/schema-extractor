import type { Schema } from "@/ir/types"
import { TAG_CANDIDATES } from "@/ir/types"
import { applyAutoRecursive } from "./auto-recursive"
import { applyFieldTagConsolidation } from "./field-tag"
import { applyHintsOnIR } from "./hint-dedup"
import { applyInlineSameKeys } from "./inline-samekeys"
import { applyInlineUnify } from "./inline-unify"
import { applyRecordify } from "./recordify"
import { rewriteIR } from "./rewrite"
import { applyTagHints } from "./tag-hints"

export interface PipelineOptions {
  rootName: string
  recordHints: readonly string[]
  dedupHints: ReadonlyArray<readonly [string, string]>
  multiTagHints: readonly string[]
}

export interface PipelineResult {
  root: Schema
  hoistedSet: Set<Schema>
  hoistNames: Map<Schema, string>
}

/**
 * Run the canonical pipeline of IR transformations. The order is significant
 * and is documented in agents.md. Each phase returns a `canonicalFor` map (and
 * sometimes new hoists / names) which is applied via `rewriteIR` before the
 * next phase runs.
 */
export function runPipeline(root: Schema, opts: PipelineOptions): PipelineResult {
  const { rootName, recordHints, dedupHints, multiTagHints } = opts

  // Phase 0
  const recordCanonical = applyRecordify(root, rootName, recordHints)
  root = rewriteIR(root, recordCanonical, new Set())

  // Phase 1a
  const hintCanonical = applyHintsOnIR(root, rootName, dedupHints)
  root = rewriteIR(root, hintCanonical, new Set())

  // Phase 1b
  const autoCanonical = applyAutoRecursive(root, rootName)
  root = rewriteIR(root, autoCanonical, new Set())

  // Phase 1b''
  const fieldTagCanonical = applyFieldTagConsolidation(root, TAG_CANDIDATES)
  root = rewriteIR(root, fieldTagCanonical, new Set())

  // Phase 1b'
  const tagHintsRes = applyTagHints(root, multiTagHints)
  root = rewriteIR(root, tagHintsRes.canonicalFor, new Set())

  // Phase 1c
  const inlineRes = applyInlineUnify(root, rootName)
  root = rewriteIR(root, inlineRes.canonicalFor, new Set())

  // Phase 1d
  const sameKeysRes = applyInlineSameKeys(root, rootName)
  root = rewriteIR(root, sameKeysRes.canonicalFor, new Set())

  const hoistedSet = new Set<Schema>()
  for (const c of inlineRes.newHoists) if (c.k === "object") hoistedSet.add(c)
  for (const c of sameKeysRes.newHoists) if (c.k === "object") hoistedSet.add(c)
  for (const c of tagHintsRes.newHoists) if (c.k === "object") hoistedSet.add(c)

  const hoistNames = new Map<Schema, string>([...sameKeysRes.hoistNames, ...tagHintsRes.hoistNames])

  return { root, hoistedSet, hoistNames }
}
