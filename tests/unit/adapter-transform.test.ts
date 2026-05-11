import { describe, expect, test } from "bun:test"
import { vscodePatchAdapter } from "@/adapters/vscode-patch"
import { checkRecords } from "@/check/index"

describe("vscodePatchAdapter.transform", () => {
  test("returns identity on non-patch input", () => {
    const records = [{ a: 1 }, { b: 2 }]
    expect(vscodePatchAdapter.transform!(records)).toBe(records)
  })

  test("replays kind:0 + kind:1 + kind:2 into a single state record", () => {
    // Need >=2 patch-like records and at least one kind:0; >=80% must be patch-like.
    const records = [
      { kind: 0, v: { name: "init", items: [1] } },
      { kind: 1, k: ["name"], v: "renamed" },
      { kind: 2, k: ["items"], v: 2 },
      { kind: 2, k: ["items"], v: [3, 4] },
    ]
    const state = vscodePatchAdapter.transform!(records)
    expect(state).toEqual([{ name: "renamed", items: [1, 2, 3, 4] }])
  })

  test("transform output validates against the same adapter's detect schema", () => {
    const records = [
      { kind: 0, v: { name: "init", count: 0 } },
      { kind: 1, k: ["count"], v: 5 },
      { kind: 1, k: ["name"], v: "renamed" },
    ]
    const schema = vscodePatchAdapter.detect(records)
    expect(schema).not.toBeNull()
    const transformed = vscodePatchAdapter.transform!(records)
    const report = checkRecords(transformed, schema!)
    expect(report.pass).toBe(true)
    expect(report.total).toBe(1)
  })
})
