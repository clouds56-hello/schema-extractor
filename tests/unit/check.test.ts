import { describe, expect, test } from "bun:test"
import { checkRecords, parseDts } from "@/index"

function schemaOf(src: string) {
  const { decls } = parseDts(src)
  return decls[decls.length - 1]!.schema
}

describe("checkRecords", () => {
  test("validates matching primitives", () => {
    const root = schemaOf(`export type R = { a: number; b: string; };`)
    const r = checkRecords([{ a: 1, b: "x" }, { a: 2, b: "y" }], root)
    expect(r.pass).toBe(true)
    expect(r.total).toBe(2)
    expect(r.failed).toBe(0)
  })

  test("rejects type mismatch", () => {
    const root = schemaOf(`export type R = { a: number; };`)
    const r = checkRecords([{ a: "nope" }], root)
    expect(r.pass).toBe(false)
    expect(r.failed).toBe(1)
    expect(r.failures[0]!.reason).toContain("expected number")
  })

  test("rejects missing required field", () => {
    const root = schemaOf(`export type R = { a: number; b: string; };`)
    const r = checkRecords([{ a: 1 }], root)
    expect(r.pass).toBe(false)
    expect(r.failures[0]!.reason).toContain("missing required")
  })

  test("accepts missing optional field", () => {
    const root = schemaOf(`export type R = { a: number; b?: string; };`)
    const r = checkRecords([{ a: 1 }], root)
    expect(r.pass).toBe(true)
  })

  test("validates union by trying variants", () => {
    const root = schemaOf(`
      export type A = { type: "a"; x: number; };
      export type B = { type: "b"; y: string; };
      export type R = A | B;
    `)
    const r = checkRecords(
      [
        { type: "a", x: 1 },
        { type: "b", y: "z" },
      ],
      root,
    )
    expect(r.pass).toBe(true)
  })

  test("counts type instances", () => {
    const root = schemaOf(`export type R = { a: number; b: string; };`)
    const r = checkRecords([{ a: 1, b: "x" }, { a: 2, b: "y" }], root)
    expect(r.typeStats.get("object")).toBe(2)
    expect(r.typeStats.get("number")).toBe(2)
    expect(r.typeStats.get("string")).toBe(2)
  })

  test("reports extra fields without failing", () => {
    const root = schemaOf(`export type R = { a: number; };`)
    const r = checkRecords([{ a: 1, extra: true }], root)
    expect(r.pass).toBe(true)
    expect([...r.fieldStats.keys()]).toContain("extra (extra)")
  })

  test("validates Record<K, V>", () => {
    const root = schemaOf(`
      export type Uuid = string;
      export type R = { items: Record<Uuid, number>; };
    `)
    const r = checkRecords([{ items: { a: 1, b: 2 } }, { items: { c: 3 } }], root)
    expect(r.pass).toBe(true)
  })
})
