import type { Schema } from "@/ir/types"
import { TAG_CANDIDATES } from "@/ir/types"
import { runtime } from "@/runtime"
import { applyAutoRecursive } from "./auto-recursive"
import { applyFieldTagConsolidation } from "./field-tag"
import { applyHintsOnIR } from "./hint-dedup"
import { applyHoistShared } from "./hoist-shared"
import { applyInlineEquivalent } from "./inline-equivalent"
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
  /** Phase emits hoists that should be folded into the cumulative hoistedSet. */
  emitsHoists?: boolean
  /** Phase prunes hoists from the cumulative set via its canonicalFor map. */
  prunesHoists?: boolean
  /**
   * Phase participates in the convergence loop. After the initial linear
   * sweep, looped phases re-run until none reports work.
   */
  loop?: boolean
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
    emitsHoists: true,
    run: (root, o) => {
      const r = applyTagHints(root, o.multiTagHints)
      return { canonicalFor: r.canonicalFor, newHoists: r.newHoists, hoistNames: r.hoistNames }
    },
  },
  {
    name: "inline-unify",
    emitsHoists: true,
    loop: true,
    run: (root, o) => {
      const r = applyInlineUnify(root, o.rootName)
      return { canonicalFor: r.canonicalFor, newHoists: r.newHoists }
    },
  },
  {
    name: "inline-samekeys",
    emitsHoists: true,
    loop: true,
    run: (root, o) => {
      const r = applyInlineSameKeys(root, o.rootName)
      return { canonicalFor: r.canonicalFor, newHoists: r.newHoists, hoistNames: r.hoistNames }
    },
  },
  {
    // Mop-up after inline-samekeys: collapse byte-identical inline objects
    // (typically small untagged shapes the same-keys policy gates rejected).
    // Pure ref-dedup; canon prefers a hoisted member when one exists so we
    // don't demote a named decl back to inline. Driver injects hoistedSet
    // via runInlineEquivalent below.
    name: "inline-equivalent",
    prunesHoists: true,
    loop: true,
    run: (root) => applyInlineEquivalent(root, new Set()),
  },
  {
    // Structural-dedupe is special: it returns a fresh `root` after iterating
    // internally. We still apply its `canonicalFor` once more in the driver to
    // catch references in collections outside the IR tree (hoistedSet,
    // hoistNames). After this phase, hoistedSet entries that became
    // non-canonical are pruned, and hoistNames are remapped.
    name: "structural-dedupe",
    prunesHoists: true,
    loop: true,
    run: (root, o) => {
      // Driver injects extraHoisted via runStructuralDedupe wrapper below.
      const r = applyStructuralDedupe(root, o.rootName, [])
      return { canonicalFor: r.canonicalFor, root: r.root }
    },
  },
  {
    // Final mop-up: any object IR with ≥2 parent references becomes a named
    // decl so the renderer doesn't emit identical bodies inline N times.
    // Pure name-addition; not loop-eligible (no IR shape changes).
    name: "hoist-shared",
    emitsHoists: true,
    run: (root) => applyHoistShared(root, new Set()),
  },
]

/**
 * Maximum number of convergence iterations after the initial sweep. Each
 * iteration re-runs the loop-marked phases. A bound prevents pathological
 * non-monotonic interactions from spinning forever; if hit, a warning is
 * printed to stderr (always, not gated on trace).
 */
const CONVERGENCE_CAP = 4

interface TraceEntry {
  name: string
  ms: number
  rewrites: number
  newHoists: number
  rootSwapped: boolean
  /** 0 = initial sweep; 1..N = convergence iteration number. */
  iter: number
}

interface DriverState {
  root: Schema
  hoistedSet: Set<Schema>
  hoistNames: Map<Schema, string>
  trace: TraceEntry[]
  wantTrace: boolean
}

/**
 * Run the canonical pipeline of IR transformations. The phase order is
 * documented in `agents.md` and encoded in `PHASES` above.
 *
 * After the initial linear sweep, phases marked `loop: true` re-run until
 * none reports work (or `CONVERGENCE_CAP` is exhausted) — this catches
 * cascades like "structural-dedupe collapses two decls, freeing inline-
 * samekeys to merge their inline siblings".
 *
 * Set `runtime.pipelineTrace = true` (or pass `--trace-pipeline` on the CLI)
 * to log per-phase timings + rewrite counts to stderr.
 */
export function runPipeline(root: Schema, opts: PipelineOptions): PipelineResult {
  const state: DriverState = {
    root,
    hoistedSet: new Set(),
    hoistNames: new Map(),
    trace: [],
    wantTrace: runtime.pipelineTrace,
  }

  // Initial linear sweep.
  for (const phase of PHASES) runPhase(phase, opts, state, 0)

  // Convergence loop: re-run loop-marked phases until quiescent.
  const loopPhases = PHASES.filter((p) => p.loop)
  let converged = false
  let iter = 0
  for (iter = 1; iter <= CONVERGENCE_CAP; iter++) {
    let progressed = false
    for (const phase of loopPhases) {
      if (runPhase(phase, opts, state, iter)) progressed = true
    }
    if (!progressed) {
      converged = true
      break
    }
  }
  if (!converged) {
    console.error(
      `[pipeline] convergence cap (${CONVERGENCE_CAP}) reached without stabilizing — re-run with --trace-pipeline to inspect`,
    )
  }

  if (state.wantTrace) emitTrace(state.trace)

  return { root: state.root, hoistedSet: state.hoistedSet, hoistNames: state.hoistNames }
}

/** Execute a single phase against `state`. Returns true iff the phase did work. */
function runPhase(phase: Phase, opts: PipelineOptions, state: DriverState, iter: number): boolean {
  const t0 = state.wantTrace ? performance.now() : 0

  const res =
    phase.name === "structural-dedupe"
      ? runStructuralDedupe(state.root, opts, state.hoistedSet)
      : phase.name === "inline-equivalent"
        ? runInlineEquivalent(state.root, state.hoistedSet)
        : phase.name === "hoist-shared"
          ? runHoistShared(state.root, state.hoistedSet)
          : phase.run(state.root, opts)

  const rootSwapped = res.root !== undefined && res.root !== state.root
  if (res.root !== undefined) state.root = res.root

  if (res.canonicalFor.size > 0) {
    state.root = rewriteIR(state.root, res.canonicalFor, new Set())
  }

  let newHoistCount = 0
  if (res.newHoists && phase.emitsHoists) {
    for (const h of res.newHoists) {
      if (h.k === "object") {
        if (!state.hoistedSet.has(h)) newHoistCount++
        state.hoistedSet.add(h)
      }
    }
  }

  if (res.hoistNames) {
    for (const [k, v] of res.hoistNames) state.hoistNames.set(k, v)
  }

  if (phase.prunesHoists) {
    for (const [k, v] of res.canonicalFor) {
      state.hoistedSet.delete(k)
      const name = state.hoistNames.get(k)
      if (name && !state.hoistNames.has(v)) state.hoistNames.set(v, name)
      state.hoistNames.delete(k)
    }
  }

  if (state.wantTrace) {
    state.trace.push({
      name: phase.name,
      ms: +(performance.now() - t0).toFixed(2),
      rewrites: res.canonicalFor.size,
      newHoists: newHoistCount,
      rootSwapped,
      iter,
    })
  }

  return res.canonicalFor.size > 0 || newHoistCount > 0 || rootSwapped
}

function runStructuralDedupe(root: Schema, opts: PipelineOptions, extraHoisted: Iterable<Schema>): PhaseResult {
  const r = applyStructuralDedupe(root, opts.rootName, extraHoisted)
  return { canonicalFor: r.canonicalFor, root: r.root }
}

function runInlineEquivalent(root: Schema, hoistedSet: ReadonlySet<Schema>): PhaseResult {
  const r = applyInlineEquivalent(root, hoistedSet)
  return { canonicalFor: r.canonicalFor }
}

function runHoistShared(root: Schema, hoistedSet: ReadonlySet<Schema>): PhaseResult {
  const r = applyHoistShared(root, hoistedSet)
  return { canonicalFor: r.canonicalFor, newHoists: r.newHoists, hoistNames: r.hoistNames }
}

function emitTrace(trace: readonly TraceEntry[]): void {
  const totalMs = trace.reduce((s, e) => s + e.ms, 0)
  const lines = ["[pipeline] iter  phase                ms   rewrites  +hoists  root"]
  for (const e of trace) {
    const iterLabel = e.iter === 0 ? "init" : `i${e.iter}`
    lines.push(
      `[pipeline] ${iterLabel.padEnd(5)} ${e.name.padEnd(20)} ${e.ms.toFixed(2).padStart(7)}  ${String(e.rewrites).padStart(8)}  ${String(e.newHoists).padStart(7)}  ${e.rootSwapped ? "swap" : "."}`,
    )
  }
  lines.push(`[pipeline] total                      ${totalMs.toFixed(2).padStart(7)}ms`)
  console.error(lines.join("\n"))
}

/** Names of phases in canonical execution order. Exposed for tests. */
export const PIPELINE_PHASE_NAMES: readonly string[] = PHASES.map((p) => p.name)

/** Names of phases that participate in the convergence loop. Exposed for tests. */
export const PIPELINE_LOOP_PHASE_NAMES: readonly string[] = PHASES.filter((p) => p.loop).map((p) => p.name)
