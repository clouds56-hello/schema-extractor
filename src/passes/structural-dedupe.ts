import { dryRender } from "@/emit/dry-render"
import { collectHoists, type HoistMeta } from "@/emit/hoist"
import { ROOT_CTX } from "@/emit/name"
import { merge } from "@/ir/merge"
import { pickTagLiteral } from "@/ir/tags"
import type { Schema } from "@/ir/types"
import { rewriteIR } from "./rewrite"

export interface StructuralDedupeResult {
  root: Schema
  canonicalFor: Map<Schema, Schema>
}

/**
 * Phase 2. Collapse structurally-equivalent hoisted decls — including
 * unrolled-recursive chains and inline-vs-hoisted shape pairs that earlier
 * passes failed to fold.
 *
 * Strategy: bucket candidate hoisted decls by `(tag-key, tag-value, sorted
 * prop-key set)`. For each bucket of size ≥2, fold all members into the first
 * via shallow per-prop merging:
 *   - prim×prim → `merge()`
 *   - same ref → no-op
 *   - everything else → wrap in a union of reference-distinct variants
 * Optionality is ANDed (any side optional → optional). After each pass we call
 * `rewriteIR` so cascading collapses propagate (e.g. once leaf decls merge,
 * parents whose children-references now coincide become eligible too).
 *
 * Bucketing is intentionally coarse: two decls with the same tag and the same
 * key set probably represent the same logical type. We avoid `mergeDeepSafe`
 * here because it recurses through prop schemas, which blows the stack on the
 * mutually-recursive IRs we're trying to fold.
 */
export function applyStructuralDedupe(
  root: Schema,
  rootName: string,
  extraHoisted: Iterable<Schema>,
  maxPasses: number,
): StructuralDedupeResult {
  const canonicalFor = new Map<Schema, Schema>()

  const collectCandidates = (): Set<Schema & { k: "object" }> => {
    const out = new Set<Schema & { k: "object" }>()
    const metas: HoistMeta[] = []
    collectHoists(root, ROOT_CTX(rootName), metas, new Set())
    for (const m of metas) out.add(m.ir)
    for (const s of extraHoisted) {
      if (s.k === "object") out.add(s)
    }
    return out
  }

  const bucketKey = (o: Schema & { k: "object" }): string | null => {
    const tag = pickTagLiteral(o)
    if (!tag) return null
    const keys = [...o.props.keys()].sort().join(",")
    return `${tag.key}\x00${String(tag.value)}\x00${keys}`
  }

  // Shallow-merge two prop schemas: prim×prim via `merge()`, identical ref
  // returns as-is, otherwise produces a reference-deduped union with a
  // structural-equivalence check (via `dryRender`) so equivalent inline
  // shapes don't proliferate as distinct union variants.
  const mergeProp = (a: Schema, b: Schema): Schema => {
    if (a === b) return a
    if (a.k === "prim" && b.k === "prim") return merge(a, b)
    const variants: Schema[] = []
    const seenRef = new Set<Schema>()
    const seenSig = new Map<string, Schema>()
    const add = (s: Schema): void => {
      if (s.k === "union") {
        for (const v of s.variants) add(v)
        return
      }
      if (seenRef.has(s)) return
      seenRef.add(s)
      const sig = dryRender(s)
      const prior = seenSig.get(sig)
      if (prior) {
        // Equivalent inline shape already present — keep canonical.
        canonicalFor.set(s, prior)
        return
      }
      seenSig.set(sig, s)
      variants.push(s)
    }
    add(a)
    add(b)
    if (variants.length === 1) return variants[0]!
    return { k: "union", variants }
  }

  // Fold `other` into `canon` shallowly. Both already share the same
  // `(tag, key set)`. Mutates canon in place.
  const foldInto = (canon: Schema & { k: "object" }, other: Schema & { k: "object" }): void => {
    for (const [k, pa] of canon.props) {
      const pb = other.props.get(k)
      if (!pb) continue
      pa.schema = mergeProp(pa.schema, pb.schema)
      pa.present += pb.present
    }
    canon.total += other.total
    // Recompute optionality: anything that wasn't fully present remains
    // optional. (canon.total has been incremented; props.present too.)
  }

  for (let pass = 0; pass < maxPasses; pass++) {
    const candidates = collectCandidates()
    if (candidates.size < 2) break

    const buckets = new Map<string, Array<Schema & { k: "object" }>>()
    for (const ir of candidates) {
      const k = bucketKey(ir)
      if (k === null) continue
      const arr = buckets.get(k) ?? []
      arr.push(ir)
      buckets.set(k, arr)
    }

    let passRewrites = 0
    const passCanonical = new Map<Schema, Schema>()
    for (const group of buckets.values()) {
      if (group.length < 2) continue
      const canon = group[0]!
      for (let i = 1; i < group.length; i++) {
        const other = group[i]!
        if (other === canon) continue
        foldInto(canon, other)
        passCanonical.set(other, canon)
        canonicalFor.set(other, canon)
        passRewrites++
      }
    }

    if (passRewrites === 0) break
    root = rewriteIR(root, passCanonical, new Set())
  }

  return { root, canonicalFor }
}
