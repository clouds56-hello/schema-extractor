import type { Schema } from "@/ir/types"
import { collectHoists, namePrefixOf, type HoistMeta } from "@/emit/hoist"
import { ROOT_CTX } from "@/emit/name"
import { mergeGroup } from "@/policy/combine"
import { HINT_POLICY } from "@/policy/presets"

/**
 * Hint-driven IR merging. For each `[scope, namePrefix]` pair, collect hoisted
 * candidates whose oldChain starts with `scope` and whose namePrefix matches,
 * then deep-merge transitively-connected components.
 */
export function applyHintsOnIR(
  root: Schema,
  rootName: string,
  dedupHints: ReadonlyArray<readonly [string, string]>,
): Map<Schema, Schema> {
  const hoists: HoistMeta[] = []
  collectHoists(root, ROOT_CTX(rootName), hoists, new Set())

  const canonicalFor = new Map<Schema, Schema>()

  for (const [scope, namePrefix] of dedupHints) {
    const candidates = hoists.filter((h) => h.oldChain.startsWith(scope) && namePrefixOf(h) === namePrefix)
    if (candidates.length < 2) continue

    const n = candidates.length
    const adj: Set<number>[] = Array.from({ length: n }, () => new Set<number>())
    for (let a = 0; a < n; a++) {
      const ka = new Set(candidates[a]!.ir.props.keys())
      for (let b = a + 1; b < n; b++) {
        let shared = false
        for (const k of candidates[b]!.ir.props.keys())
          if (ka.has(k)) {
            shared = true
            break
          }
        if (shared) {
          adj[a]!.add(b)
          adj[b]!.add(a)
        }
      }
    }
    const seen = new Set<number>()
    for (let r = 0; r < n; r++) {
      if (seen.has(r)) continue
      const comp: number[] = []
      const stack = [r]
      while (stack.length) {
        const x = stack.pop()!
        if (seen.has(x)) continue
        seen.add(x)
        comp.push(x)
        for (const y of adj[x]!) if (!seen.has(y)) stack.push(y)
      }
      if (comp.length < 2) continue
      const group = comp.map((i) => candidates[i]!)
      mergeGroup(group, HINT_POLICY, canonicalFor)
    }
  }
  return canonicalFor
}
