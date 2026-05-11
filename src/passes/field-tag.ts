import type { HoistMeta } from "@/emit/hoist"
import type { Schema } from "@/ir/types"
import { mergeGroup } from "@/policy/combine"
import { INLINE_INLINE_POLICY } from "@/policy/presets"

/**
 * Field-scoped tag consolidation. Walks the entire IR (not just collectHoists'
 * union-variant set) and buckets every tagged object by `(parentField, tagKey,
 * tagValue)`. Buckets of ≥2 are merged via INLINE_INLINE_POLICY. Catches
 * non-recursive variants whose IRs share field+tag but drift in optional fields.
 */
export function applyFieldTagConsolidation(root: Schema, tagKeys: readonly string[]): Map<Schema, Schema> {
  const canonicalFor = new Map<Schema, Schema>()
  const tagSet = new Set(tagKeys)
  type Entry = { ir: Schema & { k: "object" }; field: string }
  const buckets = new Map<string, Entry[]>()
  const seen = new Set<Schema>()

  function walk(s: Schema, parentField: string) {
    if (seen.has(s)) return
    seen.add(s)
    switch (s.k) {
      case "array":
        walk(s.item, parentField)
        return
      case "record":
        walk(s.value, parentField)
        return
      case "union":
        for (const v of s.variants) walk(v, parentField)
        return
      case "object": {
        for (const tagKey of tagSet) {
          const prop = s.props.get(tagKey)
          if (!prop || prop.schema.k !== "prim") continue
          const lits = prop.schema.literals ?? prop.schema.numLiterals
          if (!lits || lits.size !== 1) continue
          const value = [...lits][0]
          const k = `${parentField}\x00${tagKey}\x00${String(value)}`
          const arr = buckets.get(k) ?? []
          arr.push({ ir: s, field: parentField })
          buckets.set(k, arr)
          break
        }
        for (const [k, p] of s.props) walk(p.schema, k)
        return
      }
      default:
        return
    }
  }
  walk(root, "")

  for (const [, group] of buckets) {
    if (group.length < 2) continue
    const uniq = new Map<Schema, Entry>()
    for (const e of group) if (!uniq.has(e.ir)) uniq.set(e.ir, e)
    if (uniq.size < 2) continue
    const metas: HoistMeta[] = [...uniq.values()].map((e) => ({
      ir: e.ir,
      oldChain: "",
      leaf: "",
      field: e.field,
      pretty: "",
    }))
    mergeGroup(metas, INLINE_INLINE_POLICY, canonicalFor)
  }
  return canonicalFor
}
