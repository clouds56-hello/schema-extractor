import type { Schema } from "./types"
import { TAG_CANDIDATES } from "./types"
import { buildAliasMaps } from "./alias"
import { merge } from "./merge"

/** Convert a single JSON value into a fresh Schema IR. */
export function fromValue(v: unknown, isTagField = false): Schema {
  if (v === null) return { k: "prim", types: new Set(["null"]) }
  const t = typeof v
  if (t === "string") {
    const str = v as string
    const { only, ev } = buildAliasMaps(str)
    const s: Schema = {
      k: "prim",
      types: new Set(["string"]),
      seenString: true,
      aliasOnly: only,
      aliasEvidence: ev,
      minLen: str.length,
    }
    if (isTagField) (s as Schema & { k: "prim" }).literals = new Set([str])
    return s
  }
  if (t === "number") {
    const s: Schema = { k: "prim", types: new Set(["number"]) }
    if (isTagField) (s as Schema & { k: "prim" }).numLiterals = new Set([v as number])
    return s
  }
  if (t === "boolean") return { k: "prim", types: new Set(["boolean"]) }
  if (Array.isArray(v)) {
    let item: Schema = { k: "never" }
    for (const it of v) item = merge(item, fromValue(it))
    return { k: "array", item }
  }
  if (t === "object") {
    const obj = v as Record<string, unknown>
    const props = new Map<string, { schema: Schema; present: number }>()
    for (const [key, val] of Object.entries(obj)) {
      const tagField = (TAG_CANDIDATES as readonly string[]).includes(key)
      props.set(key, { schema: fromValue(val, tagField), present: 1 })
    }
    return { k: "object", total: 1, props }
  }
  return { k: "any" }
}
