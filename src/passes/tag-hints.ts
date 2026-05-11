import type { Schema } from "@/ir/types"
import { mergeGroup } from "@/policy/combine"
import { TAG_HINT_POLICY } from "@/policy/presets"
import { sha8 } from "@/emit/name"
import type { HoistMeta } from "@/emit/hoist"

export interface TagHintsResult {
  canonicalFor: Map<Schema, Schema>
  newHoists: Set<Schema>
  hoistNames: Map<Schema, string>
}

/**
 * Global tag-value consolidation. For every tag key in `tagKeys`, walk the
 * entire IR and bucket every object whose tag value is a singleton literal.
 * Buckets of ≥2 are deep-merged via TAG_HINT_POLICY (combine: shallow) and
 * hoisted as `<key>_<value>_<hash>`.
 */
export function applyTagHints(root: Schema, tagKeys: readonly string[]): TagHintsResult {
  const canonicalFor = new Map<Schema, Schema>()
  const newHoists = new Set<Schema>()
  const hoistNames = new Map<Schema, string>()
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
          const k = `${tagKey}\x00${String(value)}`
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

  for (const [key, group] of buckets) {
    if (group.length < 1) continue
    const metas: HoistMeta[] = group.map((e) => ({
      ir: e.ir,
      oldChain: "",
      leaf: "",
      field: e.field,
      pretty: "",
    }))
    const canon = group.length === 1 ? metas[0]! : mergeGroup(metas, TAG_HINT_POLICY, canonicalFor)
    if (!canon) continue
    const [tagKey, value] = key.split("\x00")
    const raw = `${tagKey}_${value}_${sha8(key)}`
    const name = /^[0-9]/.test(raw) ? `$${raw}` : raw
    newHoists.add(canon.ir)
    hoistNames.set(canon.ir, name)
  }

  return { canonicalFor, newHoists, hoistNames }
}
