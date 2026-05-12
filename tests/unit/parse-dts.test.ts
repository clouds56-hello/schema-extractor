import { describe, expect, test } from "bun:test"
import { parseDts } from "@/parse-dts/index"

describe("parseDts", () => {
  test("parses a primitive alias", () => {
    const src = "export type Uuid = string;"
    const { decls, order } = parseDts(src)
    expect(order).toEqual(["Uuid"])
    expect(decls[0]!.schema).toEqual({ k: "prim", types: new Set(["string"]) })
  })

  test("parses an object with optional + required fields", () => {
    const src = `
      export type Foo = {
        a: number;
        b?: string;
        c: boolean;
      };
    `
    const { decls } = parseDts(src)
    const s = decls[0]!.schema as Extract<(typeof decls)[0]["schema"], { k: "object" }>
    expect(s.k).toBe("object")
    expect(s.props.size).toBe(3)
    expect(s.props.get("a")!.present).toBe(1)
    expect(s.props.get("b")!.present).toBe(0) // optional
    expect(s.props.get("c")!.present).toBe(1)
  })

  test("parses unions with literals + arrays + Record", () => {
    const src = `
      export type Uuid = string;
      export type Foo = {
        kind: "a" | "b";
        items: Array<number>;
        tail: string[];
        map: Record<Uuid, number>;
      };
    `
    const { decls, order } = parseDts(src)
    expect(order).toEqual(["Uuid", "Foo"])
    const foo = decls[1]!.schema as Extract<(typeof decls)[1]["schema"], { k: "object" }>
    const kind = foo.props.get("kind")!.schema as Extract<
      typeof foo.props extends Map<string, { schema: infer S; present: number }> ? S : never,
      { k: "prim" }
    >
    expect(kind.k).toBe("prim")
    expect([...(kind.literals ?? [])].sort()).toEqual(["a", "b"])
    expect(foo.props.get("items")!.schema.k).toBe("array")
    expect(foo.props.get("tail")!.schema.k).toBe("array")
    const m = foo.props.get("map")!.schema as Extract<
      typeof foo.props extends Map<string, { schema: infer S; present: number }> ? S : never,
      { k: "record" }
    >
    expect(m.k).toBe("record")
    expect(m.key).toBe("Uuid")
    // alias resolved → value is a prim
    expect(m.value.k).toBe("prim")
  })

  test("parses tagged-union: refs to object decls inline", () => {
    const src = `
      export type A = { type: "a"; x: number; };
      export type B = { type: "b"; y: string; };
      export type Evt = A | B;
    `
    const { decls } = parseDts(src)
    const evt = decls[2]!.schema as Extract<(typeof decls)[2]["schema"], { k: "union" }>
    expect(evt.k).toBe("union")
    expect(evt.variants).toHaveLength(2)
    expect(evt.variants[0]!.k).toBe("object")
    expect(evt.variants[1]!.k).toBe("object")
  })

  test("breaks recursive types with any", () => {
    const src = `
      export type Tree = { value: number; children: Tree[]; };
    `
    const { decls } = parseDts(src)
    const t = decls[0]!.schema as Extract<(typeof decls)[0]["schema"], { k: "object" }>
    const children = t.props.get("children")!.schema as Extract<
      typeof t.props extends Map<string, { schema: infer S; present: number }> ? S : never,
      { k: "array" }
    >
    expect(children.k).toBe("array")
    expect(children.item.k).toBe("any")
  })

  test("ignores doc comments and line comments", () => {
    const src = `
      // top of file
      /** documentation */
      export type Foo = { a: number; }; // trailing
    `
    const { decls } = parseDts(src)
    expect(decls).toHaveLength(1)
    expect(decls[0]!.name).toBe("Foo")
  })
})
