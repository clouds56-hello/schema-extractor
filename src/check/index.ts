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

const FAILURE_CAP = 20

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
      // Try each variant; succeed on first match. Snapshot stats so we don't pollute
      // counts with attempted-and-failed variants.
      const snapshotTypes = new Map(report.typeStats)
      const snapshotFields = new Map(report.fieldStats)
      const errors: string[] = []
      for (const v of schema.variants) {
        const err = checkValue(value, v, report, path)
        if (err === null) return null
        errors.push(err)
        // restore stats for next attempt
        report.typeStats = new Map(snapshotTypes)
        report.fieldStats = new Map(snapshotFields)
      }
      return `no union variant matched (${errors.length} tries): ${errors[0]}`
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

export function checkRecords(records: readonly unknown[], schema: Schema): CheckReport {
  const report = newReport()
  for (let i = 0; i < records.length; i++) {
    report.total++
    const err = checkValue(records[i], schema, report, "")
    if (err !== null) {
      report.pass = false
      report.failed++
      if (report.failures.length < FAILURE_CAP) {
        report.failures.push({ index: i, path: "<root>", reason: err })
      }
    }
  }
  return report
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
