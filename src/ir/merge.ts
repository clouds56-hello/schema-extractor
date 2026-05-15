import { policyAccepts } from "@/policy/predicates"
import { STREAM_MERGE_POLICY } from "@/policy/presets"
import { runtime } from "@/runtime"
import { activeAliases, detectKeyAlias, isPathLike } from "./alias"
import { pickTagKey } from "./tags"
import type { Schema } from "./types"
import { NEVER } from "./types"

export { NEVER }

export function merge(a: Schema, b: Schema): Schema {
  if (a.k === "never") return b
  if (b.k === "never") return a
  if (a.k === "any" || b.k === "any") return { k: "any" }

  if (a.k === "union") return mergeIntoUnion(a, b)
  if (b.k === "union") return mergeIntoUnion(b, a)

  if (a.k === "prim" && b.k === "prim") {
    const tset = new Set([...a.types, ...b.types])
    let literals: Set<string> | undefined
    if (a.literals || b.literals) {
      literals = new Set<string>([...(a.literals ?? []), ...(b.literals ?? [])])
      if (literals.size > 64) literals = undefined
    }
    let numLiterals: Set<number> | undefined
    if (a.numLiterals || b.numLiterals) {
      numLiterals = new Set<number>([...(a.numLiterals ?? []), ...(b.numLiterals ?? [])])
      if (numLiterals.size > 64) numLiterals = undefined
    }
    const seenString = !!(a.seenString || b.seenString)
    const out: Schema = {
      k: "prim",
      types: tset,
      ...(literals ? { literals } : {}),
      ...(numLiterals ? { numLiterals } : {}),
    }
    if (seenString) {
      out.seenString = true
      const only = new Map<string, boolean>()
      const ev = new Map<string, boolean>()
      for (const def of activeAliases()) {
        const aa = a.seenString ? a.aliasOnly?.get(def.name) !== false : true
        const bb = b.seenString ? b.aliasOnly?.get(def.name) !== false : true
        only.set(def.name, aa && bb)
        if (def.evidence) {
          const ea = a.aliasEvidence?.get(def.name) === true
          const eb = b.aliasEvidence?.get(def.name) === true
          ev.set(def.name, ea || eb)
        }
      }
      out.aliasOnly = only
      out.aliasEvidence = ev
      const la = a.seenString && a.minLen !== undefined ? a.minLen : Number.POSITIVE_INFINITY
      const lb = b.seenString && b.minLen !== undefined ? b.minLen : Number.POSITIVE_INFINITY
      out.minLen = Math.min(la, lb)
    }
    return out
  }

  if (a.k === "array" && b.k === "array") {
    return { k: "array", item: merge(a.item, b.item) }
  }

  if (a.k === "record" && b.k === "record") {
    const key = a.key === b.key ? a.key : "string"
    return { k: "record", key, value: merge(a.value, b.value) }
  }
  if (a.k === "record" && b.k === "object") return mergeRecordWithObject(a, b)
  if (b.k === "record" && a.k === "object") return mergeRecordWithObject(b, a)

  if (a.k === "object" && b.k === "object") {
    if (!policyAccepts(a, b, STREAM_MERGE_POLICY)) return { k: "union", variants: [a, b] }
    return mergeObjects(a, b)
  }

  return { k: "union", variants: [a, b] }
}

export function mergeIntoUnion(u: Schema & { k: "union" }, x: Schema): Schema {
  if (x.k === "union") {
    let acc: Schema = u
    for (const v of x.variants) acc = acc.k === "union" ? mergeIntoUnion(acc, v) : merge(acc, v)
    return acc
  }
  const out: Schema[] = []
  let placed = false
  for (const v of u.variants) {
    if (!placed && policyAccepts(v, x, STREAM_MERGE_POLICY)) {
      const merged = merge(v, x)
      if (merged.k === "union") out.push(...merged.variants)
      else out.push(merged)
      placed = true
    } else {
      out.push(v)
    }
  }
  if (!placed) out.push(x)
  return out.length === 1 ? out[0]! : { k: "union", variants: out }
}

export function mergeRecordWithObject(rec: Schema & { k: "record" }, obj: Schema & { k: "object" }): Schema {
  const allPath = obj.props.size === 0 || [...obj.props.keys()].every(isPathLike)
  if (allPath) {
    let v: Schema = rec.value
    for (const { schema } of obj.props.values()) v = merge(v, schema)
    const objKeyAlias = obj.props.size === 0 ? rec.key : detectKeyAlias([...obj.props.keys()])
    const key = rec.key === objKeyAlias ? rec.key : "string"
    return { k: "record", key, value: v }
  }
  return { k: "union", variants: [rec, obj] }
}

export function mergeObjects(a: Schema & { k: "object" }, b: Schema & { k: "object" }): Schema {
  // Tagged-union detection: if both have the same tag key and any variant has a
  // distinct singleton value, build a union instead of merging.
  const keyA = pickTagKey(a)
  const keyB = pickTagKey(b)
  const userTag = runtime.userTagKey
  if (userTag || (keyA && keyA === keyB)) {
    const key = userTag ?? keyA!
    const propA = a.props.get(key)?.schema
    const propB = b.props.get(key)?.schema
    const litsA: Set<string | number> | undefined =
      propA?.k === "prim"
        ? ((propA.literals as Set<string> | undefined) ?? (propA.numLiterals as Set<number> | undefined))
        : undefined
    const litsB: Set<string | number> | undefined =
      propB?.k === "prim"
        ? ((propB.literals as Set<string> | undefined) ?? (propB.numLiterals as Set<number> | undefined))
        : undefined
    if (litsA && litsB) {
      const interSize = [...litsA].filter((x) => litsB.has(x)).length
      if (interSize === 0) return { k: "union", variants: [a, b] }
    }
  }

  const props = new Map<string, { schema: Schema; present: number }>()
  const total = a.total + b.total
  const allKeys = new Set<string>([...a.props.keys(), ...b.props.keys()])
  for (const k of allKeys) {
    const pa = a.props.get(k)
    const pb = b.props.get(k)
    if (pa && pb) {
      props.set(k, { schema: merge(pa.schema, pb.schema), present: pa.present + pb.present })
    } else if (pa) {
      props.set(k, { schema: pa.schema, present: pa.present })
    } else if (pb) {
      props.set(k, { schema: pb.schema, present: pb.present })
    }
  }
  return { k: "object", total, props }
}
