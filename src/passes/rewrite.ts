import type { Schema } from "@/ir/types"

/**
 * Walk `s` and substitute any IR ref present in `canonicalFor`. Mutates the
 * input tree (replacing union variants in place) and returns the new root.
 */
export function rewriteIR(s: Schema, canonicalFor: Map<Schema, Schema>, seen: Set<Schema>): Schema {
  const replaced = (canonicalFor.get(s) as Schema | undefined) ?? s
  if (seen.has(replaced)) return replaced
  seen.add(replaced)
  switch (replaced.k) {
    case "array":
      replaced.item = rewriteIR(replaced.item, canonicalFor, seen)
      return replaced
    case "record":
      replaced.value = rewriteIR(replaced.value, canonicalFor, seen)
      return replaced
    case "object":
      for (const p of replaced.props.values()) p.schema = rewriteIR(p.schema, canonicalFor, seen)
      return replaced
    case "union": {
      const newVariants: Schema[] = []
      const refSeen = new Set<Schema>()
      for (const v of replaced.variants) {
        const w = rewriteIR(v, canonicalFor, seen)
        if (refSeen.has(w)) continue
        refSeen.add(w)
        newVariants.push(w)
      }
      replaced.variants = newVariants
      return replaced
    }
    default:
      return replaced
  }
}
