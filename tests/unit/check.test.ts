import { describe, expect, test } from "bun:test"
import { checkRecords, parseDts } from "@/index"

function schemaOf(src: string) {
  const { decls } = parseDts(src)
  return decls[decls.length - 1]!.schema
}

describe("checkRecords", () => {
  test("validates matching primitives", () => {
    const root = schemaOf(`export type R = { a: number; b: string; };`)
    const r = checkRecords(
      [
        { a: 1, b: "x" },
        { a: 2, b: "y" },
      ],
      root,
    )
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
    const r = checkRecords(
      [
        { a: 1, b: "x" },
        { a: 2, b: "y" },
      ],
      root,
    )
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

  test("tag fast-path: error message points at matched variant", () => {
    const root = schemaOf(`
      export type A = { type: "a"; x: number; };
      export type B = { type: "b"; y: string; };
      export type R = A | B;
    `)
    // Bad: type=a but x is a string. Without fast-path, we'd see B's "expected
    // one of \"a\"|\"b\"" error. With fast-path, we see A's actual error.
    const r = checkRecords([{ type: "a", x: "nope" }], root)
    expect(r.pass).toBe(false)
    const msg = r.failures[0]!.reason
    expect(msg).toContain('[type="a"]')
    expect(msg).toContain("expected number")
  })

  test("tag fast-path: unknown tag value falls through to scoring", () => {
    const root = schemaOf(`
      export type A = { type: "a"; x: number; };
      export type B = { type: "b"; y: string; };
      export type R = A | B;
    `)
    const r = checkRecords([{ type: "c", x: 1 }], root)
    expect(r.pass).toBe(false)
    expect(r.failures[0]!.reason).toContain("no union variant matched")
  })

  test("untagged union: reports best-matching variant's error", () => {
    const root = schemaOf(`
      export type A = { x: number; y: number; z: number; };
      export type B = { foo: string; };
      export type R = A | B;
    `)
    // Value matches A's keys (x,y,z) but z is wrong type. Best attempt = A.
    const r = checkRecords([{ x: 1, y: 2, z: "nope" }], root)
    expect(r.pass).toBe(false)
    expect(r.failures[0]!.reason).toContain("z: expected number")
  })
})
