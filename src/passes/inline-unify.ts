import type { Schema } from "@/ir/types"
import { pickTagLiteral } from "@/ir/tags"
import { collectHoists, makeInlineMeta, type HoistMeta } from "@/emit/hoist"
import { ROOT_CTX } from "@/emit/name"
import { mergeGroup } from "@/policy/combine"
import { INLINE_VS_HOISTED_POLICY, INLINE_INLINE_POLICY } from "@/policy/presets"

export interface InlineUnifyResult {
  canonicalFor: Map<Schema, Schema>
  newHoists: Set<Schema>
}

/**
 * Phase 1c. After hint + auto-recursive passes, many union-variant tagged
 * objects are already hoisted (collectHoists targets union variants). But the
 * same shape may also appear *inline* — where it cannot be reached by
 * collectHoists. This pass finds those inline occurrences and either folds them
 * into an existing hoisted IR sharing the same tag (pass A) or unifies them
 * among themselves (pass B), producing a single shared IR per tag literal.
 */
export function applyInlineUnify(root: Schema, rootName: string): InlineUnifyResult {
  const canonicalFor = new Map<Schema, Schema>()
  const newHoists = new Set<Schema>()

  const hoists: HoistMeta[] = []
  collectHoists(root, ROOT_CTX(rootName), hoists, new Set())
  const hoistedSet = new Set<Schema>(hoists.map((h) => h.ir))
  const tagIndex = new Map<string, HoistMeta>()
  for (const h of hoists) {
    const t = pickTagLiteral(h.ir)
    if (!t) continue
    const key = `${t.key}\x00${String(t.value)}`
    if (!tagIndex.has(key)) tagIndex.set(key, h)
  }

  const inlineCandidates: Array<Schema & { k: "object" }> = []
  const visited = new Set<Schema>()
  const walk = (s: Schema): void => {
    if (visited.has(s)) return
    visited.add(s)
    if (s.k === "object") {
      if (!hoistedSet.has(s) && pickTagLiteral(s)) inlineCandidates.push(s)
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

  // Pass A: inline → matching hoisted.
  const remainingByKey = new Map<string, Array<Schema & { k: "object" }>>()
  for (const inline of inlineCandidates) {
    if (canonicalFor.has(inline)) continue
    const t = pickTagLiteral(inline)!
    const key = `${t.key}\x00${String(t.value)}`
    const hoisted = tagIndex.get(key)
    if (hoisted) {
      mergeGroup([hoisted, makeInlineMeta(inline)], INLINE_VS_HOISTED_POLICY, canonicalFor)
    } else {
      const arr = remainingByKey.get(key) ?? []
      arr.push(inline)
      remainingByKey.set(key, arr)
    }
  }

  // Pass B: inline-only buckets unify among themselves.
  for (const [, group] of remainingByKey) {
    if (group.length < 2) continue
    const metas = group.map(makeInlineMeta)
    const canon = mergeGroup(metas, INLINE_INLINE_POLICY, canonicalFor)
    if (canon) newHoists.add(canon.ir)
  }

  return { canonicalFor, newHoists }
}
