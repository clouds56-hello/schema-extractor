import { fromValue } from "@/ir/from-value"
import { merge } from "@/ir/merge"
import type { Schema } from "@/ir/types"
import { NEVER } from "@/ir/types"
import type { Adapter } from "./types"

function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function cloneJson<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value))
}

function normalizePathKey(key: unknown): string | number | null {
  if (typeof key === "string") return key
  if (typeof key === "number" && Number.isInteger(key) && key >= 0) return key
  return null
}

function containerFor(nextKey: unknown): unknown {
  return typeof nextKey === "number" ? [] : {}
}

function getChild(container: any, key: string | number): unknown {
  if (Array.isArray(container) && typeof key === "number") return container[key]
  if (isPlainObject(container) && typeof key === "string") return container[key]
  return undefined
}

function setChild(container: any, key: string | number, value: unknown) {
  if (Array.isArray(container) && typeof key === "number") container[key] = value
  else if (isPlainObject(container) && typeof key === "string") container[key] = value
}

function ensurePath(root: any, path: unknown[], leafFallback: unknown): any {
  let cur = root
  for (let i = 0; i < path.length; i++) {
    const key = normalizePathKey(path[i])
    if (key === null) return cur
    const fallback = i === path.length - 1 ? leafFallback : containerFor(path[i + 1])
    let child = getChild(cur, key)
    if (child === undefined || child === null || (typeof child !== "object" && i < path.length - 1)) {
      child = cloneJson(fallback)
      setChild(cur, key, child)
    }
    cur = child
  }
  return cur
}

function ensureParent(root: unknown, path: unknown[]): { container: any; key: string | number } | null {
  if (path.length === 0) return null
  const parentPath = path.slice(0, -1)
  const key = normalizePathKey(path[path.length - 1])
  if (key === null) return null
  return { container: ensurePath(root, parentPath, containerFor(key)), key }
}

function setPathValue(root: unknown, path: unknown[], value: unknown): unknown {
  if (path.length === 0) return value
  const nextRoot = root === undefined ? containerFor(path[0]) : root
  const parent = ensureParent(nextRoot, path)
  if (!parent) return nextRoot
  setChild(parent.container, parent.key, value)
  return nextRoot
}

function appendPathValue(root: unknown, path: unknown[], value: unknown): unknown {
  const nextRoot = root === undefined ? containerFor(path[0]) : root
  const target = ensurePath(nextRoot, path, [])
  if (Array.isArray(target)) {
    if (Array.isArray(value)) target.push(...value)
    else target.push(value)
  }
  return nextRoot
}

function recordObservedPatchValue(
  observed: Map<string, { path: unknown[]; schema: Schema }>,
  path: unknown[],
  value: unknown,
  append: boolean,
) {
  const key = JSON.stringify(path)
  const schema =
    append && Array.isArray(value)
      ? fromValue(value)
      : append
        ? ({ k: "array", item: fromValue(value) } as Schema)
        : fromValue(value)
  const prev = observed.get(key)
  observed.set(key, { path: [...path], schema: prev ? merge(prev.schema, schema) : schema })
}

function mergeSchemaAtPath(root: Schema, path: unknown[], observed: Schema): Schema {
  if (path.length === 0) return merge(root, observed)
  const [head, ...tail] = path
  const key = normalizePathKey(head)
  if (key === null) return root
  if (typeof key === "number") {
    if (root.k !== "array") return root
    return { k: "array", item: mergeSchemaAtPath(root.item, tail, observed) }
  }
  if (root.k !== "object") return root
  const props = new Map(root.props)
  const existing = props.get(key)
  const child = mergeSchemaAtPath(existing?.schema ?? NEVER, tail, observed)
  props.set(key, { schema: child, present: existing?.present ?? root.total })
  return { k: "object", total: root.total, props }
}

function looksLikeVscodePatch(records: readonly unknown[]): boolean {
  const sample = records.filter(isPlainObject).slice(0, 20)
  if (sample.length < 2) return false
  const patchLike = sample.filter((rec) => {
    if (!(rec.kind === 0 || rec.kind === 1 || rec.kind === 2)) return false
    if (!Object.hasOwn(rec, "v")) return false
    if (rec.kind === 0) return true
    return Array.isArray(rec.k)
  })
  return patchLike.length >= 2 && patchLike.length / sample.length >= 0.8 && sample.some((rec) => rec.kind === 0)
}

/**
 * Replay shared by `detect` and `transform`. Returns the final state and the
 * map of observed leaf values keyed by JSON-stringified path.
 */
function replay(records: readonly unknown[]): {
  state: unknown
  observed: Map<string, { path: unknown[]; schema: Schema }>
} | null {
  let state: unknown
  const observed = new Map<string, { path: unknown[]; schema: Schema }>()
  for (const rec of records) {
    if (!isPlainObject(rec)) continue
    const kind = rec.kind
    if (kind === 0) {
      state = cloneJson(rec.v)
    } else if (kind === 1 || kind === 2) {
      const path = Array.isArray(rec.k) ? rec.k : null
      if (!path) continue
      recordObservedPatchValue(observed, path, rec.v, kind === 2)
      if (kind === 1) state = setPathValue(state, path, cloneJson(rec.v))
      else state = appendPathValue(state, path, cloneJson(rec.v))
    }
  }
  if (state === undefined) return null
  return { state, observed }
}

/**
 * Replays VS Code chat-session patch JSONL (`{kind:0,v}`, `{kind:1,k,v}`,
 * `{kind:2,k,v}`) into a single in-memory state, then unifies the resulting
 * concrete value's schema with the schema observed at each patched leaf so the
 * "type that ever flows into path X" stays in the IR even when later patches
 * narrow it. Returns null if the file doesn't look like a patch stream.
 *
 * `transform` returns `[state]` — a single-record array whose shape is what
 * `detect`'s emitted Schema describes. Used by `check` to validate the
 * post-replay data against the committed `.d.ts`.
 */
export const vscodePatchAdapter: Adapter = {
  name: "vscode-patch",
  detect(records) {
    if (!looksLikeVscodePatch(records)) return null
    const replayed = replay(records)
    if (!replayed) return null
    let schema = fromValue(replayed.state)
    for (const entry of replayed.observed.values()) {
      schema = mergeSchemaAtPath(schema, entry.path, entry.schema)
    }
    return schema
  },
  transform(records) {
    if (!looksLikeVscodePatch(records)) return records
    const replayed = replay(records)
    if (!replayed) return records
    return [replayed.state]
  },
}
