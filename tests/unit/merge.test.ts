import { describe, expect, test } from "bun:test"
import { fromValue } from "@/ir/from-value"
import { merge } from "@/ir/merge"
import { NEVER } from "@/ir/types"

describe("merge", () => {
  test("primitive widening", () => {
    const a = fromValue("hi")
    const b = fromValue("there")
    const m = merge(a, b)
    expect(m.k).toBe("prim")
  })

  test("optional fields", () => {
    const a = fromValue({ x: 1 })
    const b = fromValue({ x: 2, y: "q" })
    const m = merge(a, b)
    expect(m.k).toBe("object")
    if (m.k !== "object") return
    expect(m.props.get("x")?.present).toBe(2)
    expect(m.props.get("y")?.present).toBe(1)
    expect(m.total).toBe(2)
  })

  test("merge with NEVER returns identity", () => {
    const a = fromValue({ x: 1 })
    expect(merge(NEVER, a)).toBe(a)
    expect(merge(a, NEVER)).toBe(a)
  })
})
