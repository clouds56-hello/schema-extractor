import { describe, expect, test } from "bun:test"
import { extractSchema } from "@/index"

describe("public API", () => {
  test("extractSchema simple", () => {
    const ts = extractSchema([{ a: 1 }, { a: 2, b: "x" }], { rootName: "X" })
    expect(ts).toContain("export type X")
    expect(ts).toContain("a: number")
    expect(ts).toContain("b?: string")
  })

  test("custom userTagKey forms a union", () => {
    const ts = extractSchema(
      [
        { op: "add", v: 1 },
        { op: "del", k: "x" },
      ],
      { rootName: "Cmd", userTagKey: "op" },
    )
    expect(ts).toMatch(/op:\s*"add"/)
    expect(ts).toMatch(/op:\s*"del"/)
  })

  test("parameters: unknown key throws at config resolution", () => {
    expect(() => extractSchema([{ a: 1 }], { rootName: "X", parameters: { "bogus.key": 1 } })).toThrow(
      /unknown parameter "bogus\.key"/,
    )
  })

  test("parameters: invalid value (negative) throws", () => {
    expect(() =>
      extractSchema([{ a: 1 }], { rootName: "X", parameters: { "hoist-shared.min-keys": -1 } }),
    ).toThrow(/non-negative/)
  })
})
