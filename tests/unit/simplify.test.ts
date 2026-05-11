import { describe, expect, test } from "bun:test"
import { simplifyDts } from "@/index"

describe("simplifyDts", () => {
  test("idempotent on already-simplified golden output", async () => {
    // alias-record.d.ts is small and uses Record/aliases; simplifying it again
    // should produce the same body (modulo header).
    const src = await Bun.file("tests/golden/expected/alias-record.d.ts").text()
    const once = simplifyDts(src, { rootName: "Root" })
    const twice = simplifyDts(once, { rootName: "Root" })
    expect(once).toBe(twice)
  })

  test("preserves the chosen root name", async () => {
    const src = `
      export type A = { x: number; };
      export type B = { y: string; };
    `
    const out = simplifyDts(src, { rootName: "A" })
    expect(out).toContain("export type A")
  })

  test("defaults root to last decl when --name not given or unmatched", async () => {
    const src = `
      export type First = { x: number; };
      export type Last = { y: string; };
    `
    const out = simplifyDts(src)
    expect(out).toContain("export type Last")
  })

  test("throws on empty input", () => {
    expect(() => simplifyDts("// just a comment\n")).toThrow(/no `export type`/)
  })
})
