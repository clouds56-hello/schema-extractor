import {
  descendArray,
  descendField,
  descendRecord,
  descendVariant,
  descendVariantFallback,
  pascal,
  type PathCtx,
  ROOT_CTX,
} from "@/emit/name"
import { detectKeyAlias } from "@/ir/alias"
import { merge } from "@/ir/merge"
import { pickTagLiteral } from "@/ir/tags"
import type { Schema } from "@/ir/types"
import { NEVER } from "@/ir/types"
import type { RecordHint } from "@/plugins/index"

/**
 * Phase 0: collapse alias-keyed objects (e.g., all-Path-keyed) into
 * `Record<KeyAlias, V>`. Also force-recordifies objects whose current field or
 * path segment matches a `recordHints` entry.
 */
export function applyRecordify(root: Schema, rootName: string, recordHints: readonly RecordHint[]): Map<Schema, Schema> {
  const canonicalFor = new Map<Schema, Schema>()
  const seen = new Set<Schema>()

  function walk(s: Schema, p: PathCtx) {
    if (seen.has(s)) return
    seen.add(s)
    switch (s.k) {
      case "array":
        walk(s.item, descendArray(p))
        return
      case "record":
        walk(s.value, descendRecord(p))
        return
      case "union":
        for (const v of s.variants) {
          if (v.k === "object") {
            const tag = pickTagLiteral(v)
            walk(v, tag ? descendVariant(p, tag.value) : descendVariantFallback(p))
          } else {
            walk(v, descendVariantFallback(p))
          }
        }
        return
      case "object": {
        for (const [k, prop] of s.props) walk(prop.schema, descendField(p, k))
        if (s.props.size === 0) return
        const keys = [...s.props.keys()]
        const hintAlias = pickRecordHintAlias(p, recordHints)
        const alias = hintAlias ?? detectKeyAlias(keys)
        if (!hintAlias && alias === "string") return
        let val: Schema = NEVER
        for (const { schema } of s.props.values()) val = merge(val, schema)
        canonicalFor.set(s, { k: "record", key: alias, value: val })
        return
      }
      default:
        return
    }
  }

  walk(root, ROOT_CTX(rootName))
  return canonicalFor
}

function pickRecordHintAlias(p: PathCtx, recordHints: readonly RecordHint[]): string | null {
  const oldSegment = p.old.split("_").at(-1) ?? ""
  for (const hint of recordHints) {
    if (typeof hint === "string") {
      const name = pascal(hint)
      if (p.field === hint || pascal(p.field) === name || oldSegment === name) return "string"
      continue
    }
    const name = pascal(hint.field)
    if (p.field === hint.field || pascal(p.field) === name || oldSegment === name) return hint.key
  }
  return null
}
