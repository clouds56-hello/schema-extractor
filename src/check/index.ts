import { pickTagLiteral } from "@/ir/tags"
import type { Schema } from "@/ir/types"

export interface FieldStat {
  count: number
  types: Set<string>
}

export interface CheckReport {
  pass: boolean
  total: number
  failed: number
  /** Per-type instance counts. Key is a stable description like "object", "string", "Uuid", or a literal value. */
  typeStats: Map<string, number>
  /** Per-dotted-path field counts, recorded only when descending into objects. */
  fieldStats: Map<string, FieldStat>
  /** First N failures with `<path>: <reason>`. Capped at 20. */
  failures: Array<{ index: number; path: string; reason: string }>
}

// FAILURE_CAP is configurable via CheckOptions.failureCap. Default below.

export function newReport(): CheckReport {
  return {
    pass: true,
    total: 0,
    failed: 0,
    typeStats: new Map(),
    fieldStats: new Map(),
    failures: [],
  }
}

function bumpType(report: CheckReport, label: string): void {
  report.typeStats.set(label, (report.typeStats.get(label) ?? 0) + 1)
}

function bumpField(report: CheckReport, path: string, valueLabel: string): void {
  const cur = report.fieldStats.get(path) ?? { count: 0, types: new Set<string>() }
  cur.count++
  cur.types.add(valueLabel)
  report.fieldStats.set(path, cur)
}

function describeValue(v: unknown): string {
  if (v === null) return "null"
  if (Array.isArray(v)) return "array"
  return typeof v
}

/**
 * For an object value, return a count of properties whose names also appear
 * in the schema's prop list. Used to score how "close" a failed union variant
 * came to matching, so the caller can report the best attempt instead of the
 * first.
 */
function scoreObjectMatch(value: unknown, schema: Schema): number {
  if (schema.k !== "object" || typeof value !== "object" || value === null || Array.isArray(value)) {
    return 0
  }
  const obj = value as Record<string, unknown>
  let n = 0
  for (const k of Object.keys(obj)) if (schema.props.has(k)) n++
  return n
}

/**
 * If `value` is an object and `variants` are objects with discriminator
 * literals, return the variant whose tag matches `value[key]`. Otherwise
 * null. Tries TAG_CANDIDATES in order (same priority as merge).
 */
function pickTagDispatch(
  value: unknown,
  variants: readonly Schema[],
): { variant: Schema; key: string; value: string | number } | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null
  const obj = value as Record<string, unknown>
  // Build (key, value) -> variant index from variants that have tag literals.
  const buckets = new Map<string, Map<string | number, Schema>>()
  for (const v of variants) {
    if (v.k !== "object") continue
    const tag = pickTagLiteral(v)
    if (!tag) continue
    let bk = buckets.get(tag.key)
    if (!bk) {
      bk = new Map()
      buckets.set(tag.key, bk)
    }
    // If two variants share the same (key, value), no fast-path is safe.
    if (bk.has(tag.value)) bk.set(tag.value, { k: "any" } as Schema)
    else bk.set(tag.value, v)
  }
  if (buckets.size === 0) return null
  for (const [key, bk] of buckets) {
    const tv = obj[key]
    if (typeof tv !== "string" && typeof tv !== "number") continue
    const variant = bk.get(tv)
    if (variant && variant.k === "object") return { variant, key, value: tv }
  }
  return null
}

/** Check a single value against a schema. Returns null on success, error string on failure. */
function checkValue(value: unknown, schema: Schema, report: CheckReport, path: string): string | null {
  switch (schema.k) {
    case "any":
      bumpType(report, "any")
      return null
    case "never":
      return `expected never, got ${describeValue(value)}`
    case "prim": {
      const t = describeValue(value)
      if (t === "array" || t === "object") return `expected primitive (${[...schema.types].join("|")}), got ${t}`
      // accept if type matches one of allowed prims
      if (t === "string" && schema.types.has("string")) {
        if (schema.literals && schema.literals.size > 0 && !schema.literals.has(value as string)) {
          return `expected one of ${[...schema.literals].map((x) => JSON.stringify(x)).join("|")}, got ${JSON.stringify(value)}`
        }
        bumpType(report, schema.literals && schema.literals.size > 0 ? JSON.stringify(value) : "string")
        return null
      }
      if (t === "number" && schema.types.has("number")) {
        if (schema.numLiterals && schema.numLiterals.size > 0 && !schema.numLiterals.has(value as number)) {
          return `expected one of ${[...schema.numLiterals].join("|")}, got ${value}`
        }
        bumpType(report, schema.numLiterals && schema.numLiterals.size > 0 ? String(value) : "number")
        return null
      }
      if (t === "boolean" && schema.types.has("boolean")) {
        bumpType(report, "boolean")
        return null
      }
      if (value === null && schema.types.has("null")) {
        bumpType(report, "null")
        return null
      }
      return `expected ${[...schema.types].join("|")}, got ${t}`
    }
    case "array": {
      if (!Array.isArray(value)) return `expected array, got ${describeValue(value)}`
      bumpType(report, "array")
      for (let i = 0; i < value.length; i++) {
        const err = checkValue(value[i], schema.item, report, `${path}[${i}]`)
        if (err) return err
      }
      return null
    }
    case "record": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return `expected object (record), got ${describeValue(value)}`
      }
      bumpType(report, "record")
      for (const [k, v] of Object.entries(value)) {
        const err = checkValue(v, schema.value, report, `${path}.${k}`)
        if (err) return err
      }
      return null
    }
    case "union": {
      // Fast path: if variants are tag-discriminated objects and `value` carries
      // a matching tag literal, validate against that variant directly so the
      // error message points at the right place.
      const dispatch = pickTagDispatch(value, schema.variants)
      if (dispatch) {
        const err = checkValue(value, dispatch.variant, report, path)
        if (err === null) return null
        return `[${dispatch.key}=${JSON.stringify(dispatch.value)}] ${err}`
      }
      // Try each variant; succeed on first match. We DO NOT snapshot/restore
      // stats around variant attempts because doing so is `O(stats_size)` per
      // try and explodes on deeply-nested untagged unions. The cost is mildly
      // inflated stats for failed-variant attempts; acceptable because tagged
      // unions hit the fast path above and don't pay this cost at all.
      let best: { score: number; err: string } | null = null
      for (const v of schema.variants) {
        const err = checkValue(value, v, report, path)
        if (err === null) return null
        const score = scoreObjectMatch(value, v)
        if (best === null || score > best.score) best = { score, err }
      }
      const reason = best ? best.err : "no variants"
      return `no union variant matched (${schema.variants.length} tries): ${reason}`
    }
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return `expected object, got ${describeValue(value)}`
      }
      bumpType(report, "object")
      const obj = value as Record<string, unknown>
      // required fields must be present
      for (const [k, p] of schema.props) {
        const required = p.present === schema.total
        if (!(k in obj)) {
          if (required) return `missing required field "${k}"`
          continue
        }
        bumpField(report, path === "" ? k : `${path}.${k}`, describeValue(obj[k]))
        const err = checkValue(obj[k], p.schema, report, path === "" ? k : `${path}.${k}`)
        if (err) return `${k}: ${err}`
      }
      // unknown fields: tolerate (structural subtype) but count them
      for (const k of Object.keys(obj)) {
        if (!schema.props.has(k)) {
          bumpField(report, path === "" ? `${k} (extra)` : `${path}.${k} (extra)`, describeValue(obj[k]))
        }
      }
      return null
    }
  }
}

const DEFAULT_FAILURE_CAP = 20

export interface CheckOptions {
  /** Max failures retained per report. Default: 20. */
  failureCap?: number
}

export function checkRecords(
  records: readonly unknown[],
  schema: Schema,
  opts: CheckOptions = {},
): CheckReport {
  const cap = opts.failureCap ?? DEFAULT_FAILURE_CAP
  const report = newReport()
  for (let i = 0; i < records.length; i++) {
    report.total++
    const err = checkValue(records[i], schema, report, "")
    if (err !== null) {
      report.pass = false
      report.failed++
      if (report.failures.length < cap) {
        report.failures.push({ index: i, path: "<root>", reason: err })
      }
    }
  }
  return report
}

/** Aggregate `add` into `into` (mutates `into`). Failures retain global cap. */
export function mergeReport(into: CheckReport, add: CheckReport, opts: CheckOptions = {}): void {
  const cap = opts.failureCap ?? DEFAULT_FAILURE_CAP
  into.total += add.total
  into.failed += add.failed
  if (!add.pass) into.pass = false
  for (const [k, v] of add.typeStats) into.typeStats.set(k, (into.typeStats.get(k) ?? 0) + v)
  for (const [k, v] of add.fieldStats) {
    const cur = into.fieldStats.get(k) ?? { count: 0, types: new Set<string>() }
    cur.count += v.count
    for (const t of v.types) cur.types.add(t)
    into.fieldStats.set(k, cur)
  }
  for (const f of add.failures) {
    if (into.failures.length >= cap) break
    into.failures.push(f)
  }
}

export function formatReport(report: CheckReport, detail: boolean): string {
  const lines: string[] = []
  lines.push(`${report.pass ? "OK" : "FAIL"} ${report.total - report.failed}/${report.total} records`)
  const top = [...report.typeStats.entries()].sort((a, b) => b[1] - a[1])
  if (top.length > 0) {
    lines.push(`types: ${top.map(([k, v]) => `${k}=${v}`).join(", ")}`)
  }
  if (detail && report.fieldStats.size > 0) {
    lines.push("fields:")
    const fs = [...report.fieldStats.entries()].sort((a, b) => b[1].count - a[1].count)
    for (const [k, v] of fs) {
      lines.push(`  ${k}  count=${v.count}  types={${[...v.types].sort().join(",")}}`)
    }
  }
  if (report.failures.length > 0) {
    lines.push(`failures (showing ${report.failures.length}):`)
    for (const f of report.failures) {
      lines.push(`  #${f.index} ${f.path}: ${f.reason}`)
    }
  }
  return `${lines.join("\n")}\n`
}
