import type { Schema } from "@/ir/types"
import { detectKeyAlias } from "@/ir/alias"
import { dryRender } from "@/emit/dry-render"
import type { SimilarKind } from "./types"

export function similarAccepts(a: Schema, b: Schema, kind: SimilarKind): boolean {
  if (a.k !== "object" || b.k !== "object") return true
  if (kind === "any") return true
  if (kind === "same-keys") {
    if (a.props.size !== b.props.size) return false
    for (const k of a.props.keys()) if (!b.props.has(k)) return false
    return true
  }
  if (kind === "subset-keys") {
    const [smaller, larger] = a.props.size <= b.props.size ? [a, b] : [b, a]
    for (const k of smaller.props.keys()) if (!larger.props.has(k)) return false
    return true
  }
  if (kind === "alias-keys-compat") {
    if (a.props.size === 0 || b.props.size === 0) return false
    const ka = detectKeyAlias([...a.props.keys()])
    if (ka === "string") return false
    const kb = detectKeyAlias([...b.props.keys()])
    return ka === kb
  }
  if (kind === "nullable-compat") {
    return false
  }
  if (typeof kind === "object" && kind.kind === "overlap-min") {
    let n = 0
    for (const k of a.props.keys())
      if (b.props.has(k)) {
        n++
        if (n >= kind.n) return true
      }
    return n >= kind.n
  }
  if (typeof kind === "object" && kind.kind === "keys-lt") {
    return a.props.size < kind.n && b.props.size < kind.n
  }
  if (typeof kind === "object" && kind.kind === "keys-gt") {
    return a.props.size > kind.n && b.props.size > kind.n
  }
  if (kind === "types-match") {
    for (const [k, pa] of a.props) {
      const pb = b.props.get(k)
      if (!pb) continue
      if (!typesCompat(pa.schema, pb.schema)) return false
    }
    return true
  }
  return true
}

/**
 * Recursive structural compatibility used by `types-match`. Treats string
 * aliases as compatible with plain `string` (the supertype). Two distinct
 * stricter aliases (Path vs Url) are NOT compatible — they should form a union.
 */
export function typesCompat(a: Schema, b: Schema): boolean {
  if (a === b) return true
  if (a.k !== b.k) return dryRender(a) === dryRender(b)
  if (a.k === "prim" && b.k === "prim") {
    if (a.types.size !== b.types.size) return false
    for (const t of a.types) if (!b.types.has(t)) return false
    if (a.types.has("string")) {
      const ra = dryRender(a)
      const rb = dryRender(b)
      if (ra === rb) return true
      if (ra === "string" || rb === "string") return true
      return false
    }
    return dryRender(a) === dryRender(b)
  }
  if (a.k === "array" && b.k === "array") return typesCompat(a.item, b.item)
  if (a.k === "record" && b.k === "record") {
    return a.key === b.key && typesCompat(a.value, b.value)
  }
  if (a.k === "object" && b.k === "object") {
    for (const [k, pa] of a.props) {
      const pb = b.props.get(k)
      if (!pb) continue
      if (!typesCompat(pa.schema, pb.schema)) return false
    }
    return true
  }
  return dryRender(a) === dryRender(b)
}
