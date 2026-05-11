import type { Schema } from "@/ir/types"
import { pickTagLiteral } from "@/ir/tags"
import { collectHoists, type HoistMeta } from "@/emit/hoist"
import { ROOT_CTX } from "@/emit/name"
import { mergeGroup } from "@/policy/combine"
import { AUTO_RECURSIVE_POLICY } from "@/policy/presets"

function pushChildren(s: Schema, stack: Schema[], seen: Set<Schema>): void {
  switch (s.k) {
    case "object":
      for (const p of s.props.values()) {
        if (seen.has(p.schema)) continue
        seen.add(p.schema)
        stack.push(p.schema)
      }
      return
    case "array":
      if (!seen.has(s.item)) {
        seen.add(s.item)
        stack.push(s.item)
      }
      return
    case "record":
      if (!seen.has(s.value)) {
        seen.add(s.value)
        stack.push(s.value)
      }
      return
    case "union":
      for (const v of s.variants) {
        if (seen.has(v)) continue
        seen.add(v)
        stack.push(v)
      }
      return
  }
}

/**
 * Auto-detect recursive types: any object IR with a tag literal that contains
 * (transitively) another object IR with the same tag literal under the same field
 * is treated as one recursive type.
 */
export function applyAutoRecursive(root: Schema, rootName: string): Map<Schema, Schema> {
  const hoists: HoistMeta[] = []
  collectHoists(root, ROOT_CTX(rootName), hoists, new Set())

  const canonicalFor = new Map<Schema, Schema>()

  const buckets = new Map<string, HoistMeta[]>()
  for (const h of hoists) {
    const tag = pickTagLiteral(h.ir)
    if (!tag) continue
    const key = `${h.field}\x00${tag.key}\x00${String(tag.value)}`
    const arr = buckets.get(key) ?? []
    arr.push(h)
    buckets.set(key, arr)
  }

  for (const [, group] of buckets) {
    if (group.length < 2) continue

    const n = group.length
    const reach: boolean[][] = Array.from({ length: n }, () => Array(n).fill(false) as boolean[])
    for (let i = 0; i < n; i++) {
      const targets = new Set<Schema>()
      for (let j = 0; j < n; j++) if (i !== j) targets.add(group[j]!.ir)
      if (targets.size === 0) continue
      const found = new Set<Schema>()
      const stack: Schema[] = []
      const seen = new Set<Schema>([group[i]!.ir])
      pushChildren(group[i]!.ir, stack, seen)
      while (stack.length) {
        const cur = stack.pop()!
        if (targets.has(cur)) found.add(cur)
        pushChildren(cur, stack, seen)
      }
      for (let j = 0; j < n; j++) if (i !== j && found.has(group[j]!.ir)) reach[i]![j] = true
    }

    const adj: Set<number>[] = Array.from({ length: n }, () => new Set<number>())
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++)
        if (reach[i]![j] || reach[j]![i]) {
          adj[i]!.add(j)
          adj[j]!.add(i)
        }
    const seen = new Set<number>()
    for (let r = 0; r < n; r++) {
      if (seen.has(r)) continue
      const comp: number[] = []
      const stack = [r]
      while (stack.length) {
        const x = stack.pop()!
        if (seen.has(x)) continue
        seen.add(x)
        comp.push(x)
        for (const y of adj[x]!) if (!seen.has(y)) stack.push(y)
      }
      if (comp.length < 2) continue
      const compGroup = comp.map((i) => group[i]!)
      mergeGroup(compGroup, AUTO_RECURSIVE_POLICY, canonicalFor)
    }
  }
  return canonicalFor
}
