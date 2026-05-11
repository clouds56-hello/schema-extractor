// Tag-discriminator helpers — pure inspection of an object IR's properties.
// These are pulled out of merge.ts so policy/ can use them without creating a cycle.

import { runtime } from "@/runtime"
import type { Schema } from "./types"
import { TAG_CANDIDATES } from "./types"

export function pickTagLiteral(o: Schema & { k: "object" }): { key: string; value: string | number } | null {
  for (const key of TAG_CANDIDATES) {
    const p = o.props.get(key)
    if (!p || p.present !== o.total) continue
    if (p.schema.k !== "prim") continue
    const types = p.schema.types
    if (types.size !== 1) continue
    if (types.has("string")) {
      const lits = p.schema.literals
      if (!lits || lits.size !== 1) continue
      return { key, value: [...lits][0]! }
    }
    if (types.has("number")) {
      const lits = p.schema.numLiterals
      if (!lits || lits.size !== 1) continue
      return { key, value: [...lits][0]! }
    }
  }
  return null
}

export function pickTagKey(o: Schema & { k: "object" }): string | null {
  for (const key of TAG_CANDIDATES) {
    const p = o.props.get(key)
    if (!p || p.present !== o.total) continue
    if (p.schema.k !== "prim") continue
    const types = p.schema.types
    if (types.size !== 1) continue
    if (types.has("string") && p.schema.literals && p.schema.literals.size > 0) return key
    if (types.has("number") && p.schema.numLiterals && p.schema.numLiterals.size > 0) return key
  }
  return null
}

export function hasTagKey(o: Schema & { k: "object" }): boolean {
  for (const k of o.props.keys()) {
    if ((TAG_CANDIDATES as readonly string[]).includes(k)) return true
    if (k === runtime.userTagKey) return true
  }
  return false
}

/**
 * Two object IRs may be merged iff for every TAG_CANDIDATES key with literals on
 * either side, the literal sets overlap.
 */
export function compatibleForMerge(a: Schema, b: Schema): boolean {
  if (a.k !== b.k) return false
  if (a.k === "object" && b.k === "object") {
    for (const key of TAG_CANDIDATES) {
      const sa = a.props.get(key)?.schema
      const sb = b.props.get(key)?.schema
      const litsA: Set<string | number> | undefined =
        sa?.k === "prim"
          ? ((sa.literals as Set<string> | undefined) ?? (sa.numLiterals as Set<number> | undefined))
          : undefined
      const litsB: Set<string | number> | undefined =
        sb?.k === "prim"
          ? ((sb.literals as Set<string> | undefined) ?? (sb.numLiterals as Set<number> | undefined))
          : undefined
      if (!litsA && !litsB) continue
      if (!litsA || !litsB) return false
      let overlap = false
      for (const v of litsA)
        if (litsB.has(v)) {
          overlap = true
          break
        }
      if (!overlap) return false
    }
    return true
  }
  return true
}
