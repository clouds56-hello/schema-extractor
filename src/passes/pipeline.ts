import { TAG_CANDIDATES } from "@/ir/types"
import type { Schema } from "@/ir/types"
import { runtime } from "@/runtime"
import { applyAutoRecursive } from "./auto-recursive"
import { applyFieldTagConsolidation } from "./field-tag"
import { applyHintsOnIR } from "./hint-dedup"
import { applyInlineSameKeys } from "./inline-samekeys"
import { applyInlineUnify } from "./inline-unify"
import { applyRecordify } from "./recordify"
import { rewriteIR } from "./rewrite"
import { applyStructuralDedupe } from "./structural-dedupe"
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
 * Per-phase result returned by a {@link Phase}'s `run`.
 *  - `canonicalFor`: ref → canonical-ref map. Empty maps short-circuit the
 *    rewrite walk.
 *  - `newHoists`: hoist candidates this phase introduced (object schemas only
 *    are kept; non-objects are filtered by the driver).
 *  - `hoistNames`: stable display names for hoisted schemas. Merged into the
 *    cumulative name map; later phases win on conflict only via remap.
 *  - `root`: phases that physically rebuild the root tree (e.g.
 *    structural-dedupe) return it here so the driver can pick it up before
 *    applying canonical rewrites.
 */
interface PhaseResult {
  canonicalFor: Map<Schema, Schema>
  newHoists?: Iterable<Schema>
  hoistNames?: Map<Schema, string>
  root?: Schema
}

interface Phase {
  name: string
  run(root: Schema, opts: PipelineOptions): PhaseResult
}

/**
 * Canonical phase order. **Reordering breaks fixtures.** See
 * `agents.md` § Pipeline for rationale of each slot.
 */
const PHASES: readonly Phase[] = [
  {
    name: "recordify",
    run: (root, o) => ({ canonicalFor: applyRecordify(root, o.rootName, o.recordHints) }),
  },
  {
    name: "hint-dedup",
    run: (root, o) => ({ canonicalFor: applyHintsOnIR(root, o.rootName, o.dedupHints) }),
  },
  {
    name: "auto-recursive",
    run: (root, o) => ({ canonicalFor: applyAutoRecursive(root, o.rootName) }),
  },
  {
    name: "field-tag",
    run: (root) => ({ canonicalFor: applyFieldTagConsolidation(root, TAG_CANDIDATES) }),
  },
  {
    name: "tag-hints",
    run: (root, o) => {
      const r = applyTagHints(root, o.multiTagHints)
      return { canonicalFor: r.canonicalFor, newHoists: r.newHoists, hoistNames: r.hoistNames }
    },
  },
  {
    name: "inline-unify",
    run: (root, o) => {
      const r = applyInlineUnify(root, o.rootName)
      return { canonicalFor: r.canonicalFor, newHoists: r.newHoists }
    },
  },
  {
    name: "inline-samekeys",
    run: (root, o) => {
      const r = applyInlineSameKeys(root, o.rootName)
      return { canonicalFor: r.canonicalFor, newHoists: r.newHoists, hoistNames: r.hoistNames }
    },
  },
  {
    // Structural-dedupe is special: it returns a fresh `root` after iterating
    // internally. We still apply its `canonicalFor` once more in the driver to
    // catch references in collections outside the IR tree (hoistedSet,
    // hoistNames). After this phase, hoistedSet entries that became
    // non-canonical are pruned, and hoistNames are remapped.
    name: "structural-dedupe",
    run: (root, o) => {
      const r = applyStructuralDedupe(root, o.rootName, [])
      return { canonicalFor: r.canonicalFor, root: r.root }
    },
  },
]

/**
 * Phases whose `newHoists` should be folded into the cumulative
 * `hoistedSet`. Excludes structural-dedupe (which only removes).
 */
const HOIST_PHASES = new Set([
  "tag-hints",
  "inline-unify",
  "inline-samekeys",
])

interface TraceEntry {
  name: string
  ms: number
  rewrites: number
  newHoists: number
  rootSwapped: boolean
}

/**
 * Run the canonical pipeline of IR transformations. The phase order is
 * documented in `agents.md` and encoded in `PHASES` above.
 *
 * Set `runtime.pipelineTrace = true` (or pass `--trace-pipeline` on the CLI)
 * to log per-phase timings + rewrite counts to stderr.
 */
export function runPipeline(root: Schema, opts: PipelineOptions): PipelineResult {
  const hoistedSet = new Set<Schema>()
  const hoistNames = new Map<Schema, string>()
  const trace: TraceEntry[] = []
  const wantTrace = runtime.pipelineTrace

  // Structural-dedupe needs the in-flight hoistedSet (so it can also fold
  // hoists introduced by earlier phases). We pass it positionally below.
  for (const phase of PHASES) {
    const t0 = wantTrace ? performance.now() : 0
    const res =
      phase.name === "structural-dedupe"
        ? runStructuralDedupePhase(root, opts, hoistedSet)
        : phase.run(root, opts)

    const rootSwapped = res.root !== undefined && res.root !== root
    if (res.root !== undefined) root = res.root

    if (res.canonicalFor.size > 0) {
      root = rewriteIR(root, res.canonicalFor, new Set())
    }

    let newHoistCount = 0
    if (res.newHoists && HOIST_PHASES.has(phase.name)) {
      for (const h of res.newHoists) {
        if (h.k === "object") {
          hoistedSet.add(h)
          newHoistCount++
        }
      }
    }

    if (res.hoistNames) {
      for (const [k, v] of res.hoistNames) hoistNames.set(k, v)
    }

    if (phase.name === "structural-dedupe") {
      // Prune collapsed hoists; remap names so the surviving canonical decl
      // inherits a name from any of the merged-away decls.
      for (const [k, v] of res.canonicalFor) {
        hoistedSet.delete(k)
        const name = hoistNames.get(k)
        if (name && !hoistNames.has(v)) hoistNames.set(v, name)
        hoistNames.delete(k)
      }
    }

    if (wantTrace) {
      trace.push({
        name: phase.name,
        ms: +(performance.now() - t0).toFixed(2),
        rewrites: res.canonicalFor.size,
        newHoists: newHoistCount,
        rootSwapped,
      })
    }
  }

  if (wantTrace) emitTrace(trace)

  return { root, hoistedSet, hoistNames }
}

function runStructuralDedupePhase(
  root: Schema,
  opts: PipelineOptions,
  extraHoisted: Iterable<Schema>,
): PhaseResult {
  const r = applyStructuralDedupe(root, opts.rootName, extraHoisted)
  return { canonicalFor: r.canonicalFor, root: r.root }
}

function emitTrace(trace: readonly TraceEntry[]): void {
  const totalMs = trace.reduce((s, e) => s + e.ms, 0)
  const lines = ["[pipeline] phase                ms   rewrites  +hoists  root"]
  for (const e of trace) {
    lines.push(
      `[pipeline] ${e.name.padEnd(20)} ${e.ms.toFixed(2).padStart(7)}  ${String(e.rewrites).padStart(8)}  ${String(e.newHoists).padStart(7)}  ${e.rootSwapped ? "swap" : "."}`,
    )
  }
  lines.push(`[pipeline] total                ${totalMs.toFixed(2).padStart(7)}ms`)
  console.error(lines.join("\n"))
}

/** Names of phases in canonical execution order. Exposed for tests. */
export const PIPELINE_PHASE_NAMES: readonly string[] = PHASES.map((p) => p.name)
