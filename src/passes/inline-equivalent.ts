import { dryRender } from "@/emit/dry-render"
import type { Schema } from "@/ir/types"

export interface InlineEquivalentResult {
  canonicalFor: Map<Schema, Schema>
}

/**
 * Phase: collapse byte-identical inline objects.
 *
 * Walks `root`, collects every object IR (≥1 prop, tagged or untagged), buckets
 * by `dryRender(s)` signature, and folds each bucket of size ≥2 into one canon
 * by registering canonical-rewrites. Canon selection prefers a member already
 * in `hoistedSet` so we never demote a named decl back to inline; falls back
 * to the first-walked member otherwise. No new hoists are emitted; this is
 * pure ref-deduplication.
 *
 * Designed to mop up post-`inline-samekeys` leftovers — particularly small
 * (≤3 key) untagged shapes the same-keys policy gates reject (`keys-gt:3`)
 * and that `structural-dedupe` ignores (untagged). Loop-eligible.
 */
export function applyInlineEquivalent(root: Schema, hoistedSet: ReadonlySet<Schema>): InlineEquivalentResult {
  const canonicalFor = new Map<Schema, Schema>()

  const seen = new Set<Schema>()
  const objects: Array<Schema & { k: "object" }> = []
  const walk = (s: Schema): void => {
    if (seen.has(s)) return
    seen.add(s)
    if (s.k === "object") {
      if (s.props.size > 0) objects.push(s)
      for (const p of s.props.values()) walk(p.schema)
    } else if (s.k === "array") {
      walk(s.item)
    } else if (s.k === "record") {
      walk(s.value)
    } else if (s.k === "union") {
      for (const v of s.variants) walk(v)
    }
  }
  walk(root)
  // Also include hoisted IRs even if walk didn't reach them (some hoists may
  // be detached from `root` after upstream rewrites; we still want to consider
  // them as candidates so we can pick a hoisted member as canon).
  for (const h of hoistedSet) {
    if (h.k === "object" && !seen.has(h)) {
      seen.add(h)
      objects.push(h)
    }
  }

  const buckets = new Map<string, Array<Schema & { k: "object" }>>()
  for (const o of objects) {
    const sig = dryRender(o)
    const arr = buckets.get(sig) ?? []
    arr.push(o)
    buckets.set(sig, arr)
  }

  for (const group of buckets.values()) {
    if (group.length < 2) continue
    // Prefer a hoisted member as canonical so we don't demote a named decl
    // back to inline. Falls back to the first-walked member.
    const hoistedIdx = group.findIndex((o) => hoistedSet.has(o))
    const canonIdx = hoistedIdx >= 0 ? hoistedIdx : 0
    const canon = group[canonIdx]!
    for (let i = 0; i < group.length; i++) {
      if (i === canonIdx) continue
      const other = group[i]!
      if (other === canon) continue
      canonicalFor.set(other, canon)
    }
  }

  return { canonicalFor }
}
