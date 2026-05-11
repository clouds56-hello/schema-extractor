import type { Schema } from "@/ir/types"
import { hasTagKey, pickTagLiteral } from "@/ir/tags"
import { collectHoists, type HoistMeta } from "@/emit/hoist"
import { ROOT_CTX, pascal, sha8 } from "@/emit/name"
import { mergeGroup } from "@/policy/combine"
import { INLINE_SAMEKEYS_POLICY } from "@/policy/presets"

export interface SameKeysResult {
  canonicalFor: Map<Schema, Schema>
  newHoists: Set<Schema>
  hoistNames: Map<Schema, string>
}

/**
 * Phase 1d: same-keys consolidation for untagged inline objects. Collects every
 * untagged object IR with > 1 prop and buckets them globally by sorted-keys
 * signature; merges per bucket and assigns a hoist name `<Field>_Type_<hash>`.
 */
export function applyInlineSameKeys(root: Schema, rootName: string): SameKeysResult {
  const canonicalFor = new Map<Schema, Schema>()
  const newHoists = new Set<Schema>()
  const hoistNames = new Map<Schema, string>()

  const hoists: HoistMeta[] = []
  collectHoists(root, ROOT_CTX(rootName), hoists, new Set())
  const hoistedSet = new Set<Schema>(hoists.map((h) => h.ir))

  type Entry = { ir: Schema & { k: "object" }; field: string }
  const entries: Entry[] = []
  const seen = new Set<Schema>()
  const walk = (s: Schema, parentField: string): void => {
    if (seen.has(s)) return
    seen.add(s)
    if (s.k === "object") {
      if (s.props.size > 1 && !pickTagLiteral(s) && !hasTagKey(s)) {
        entries.push({ ir: s, field: parentField })
      }
      for (const [k, p] of s.props) walk(p.schema, k)
    } else if (s.k === "array") {
      walk(s.item, parentField)
    } else if (s.k === "record") {
      walk(s.value, parentField)
    } else if (s.k === "union") {
      for (const v of s.variants) walk(v, parentField)
    }
  }
  walk(root, "")

  const buckets = new Map<string, Entry[]>()
  for (const e of entries) {
    const sig = [...e.ir.props.keys()].sort().join("\x00")
    const arr = buckets.get(sig) ?? []
    arr.push(e)
    buckets.set(sig, arr)
  }

  for (const [sig, group] of buckets) {
    if (group.length < 2) continue
    const metas: HoistMeta[] = group.map((e) => ({
      ir: e.ir,
      oldChain: "",
      leaf: "",
      field: e.field,
      pretty: "",
    }))
    const canon = mergeGroup(metas, INLINE_SAMEKEYS_POLICY, canonicalFor)
    if (!canon) continue
    if (!hoistedSet.has(canon.ir)) {
      newHoists.add(canon.ir)
      const fieldSeg = canon.field ? pascal(canon.field) : ""
      const hash = sha8(sig)
      const raw = fieldSeg ? `${fieldSeg}_Type_${hash}` : `Type_${hash}`
      const name = /^[0-9]/.test(raw) ? `$${raw}` : raw
      hoistNames.set(canon.ir, name)
    }
  }

  return { canonicalFor, newHoists, hoistNames }
}
