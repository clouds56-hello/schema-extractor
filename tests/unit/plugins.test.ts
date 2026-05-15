import { describe, expect, test } from "bun:test"
import type { Schema } from "@/ir/types"
import { collectContributions, copilotCliPlugin, DEFAULT_PLUGINS, resolvePluginNames, vscodePlugin } from "@/plugins/index"

function obj(props: Record<string, Schema>): Schema & { k: "object" } {
  const m = new Map<string, { schema: Schema; present: number }>()
  for (const [k, v] of Object.entries(props)) m.set(k, { schema: v, present: 1 })
  return { k: "object", total: 1, props: m }
}

const STR: Schema = { k: "prim", types: new Set(["string"]) }

function numLit(n: number): Schema {
  return { k: "prim", types: new Set(["number"]), numLiterals: new Set([n]) }
}

describe("vscode plugin", () => {
  test("contributes $mid as multi-tag hint", () => {
    const c = vscodePlugin.contribute?.()
    expect(c?.multiTagHints).toContain("$mid")
  })

  test("matches $mid:1 → VscodeUri with hoist", () => {
    const ir = obj({ $mid: numLit(1), path: STR })
    const r = vscodePlugin.match?.(ir, { field: "" })
    expect(r).toEqual({ name: "VscodeUri", hoist: true })
  })

  test("matches $mid:21 → VscodeLanguageModelTextPart", () => {
    const ir = obj({ $mid: numLit(21), value: STR })
    expect(vscodePlugin.match?.(ir, { field: "" })?.name).toBe("VscodeLanguageModelTextPart")
  })

  test("ignores objects without $mid", () => {
    const ir = obj({ foo: STR })
    expect(vscodePlugin.match?.(ir, { field: "" })).toBeNull()
  })

  test("ignores unknown $mid values", () => {
    const ir = obj({ $mid: numLit(999) })
    expect(vscodePlugin.match?.(ir, { field: "" })).toBeNull()
  })

  test("ignores non-singleton $mid literal sets", () => {
    const ir = obj({ $mid: { k: "prim", types: new Set(["number"]), numLiterals: new Set([1, 2]) } })
    expect(vscodePlugin.match?.(ir, { field: "" })).toBeNull()
  })

  test("default plugin chain includes vscode", () => {
    expect(DEFAULT_PLUGINS).toContain(vscodePlugin)
  })

  test("collectContributions deduplicates across plugins", () => {
    const c = collectContributions([vscodePlugin, vscodePlugin])
    expect(c.multiTagHints.filter((t) => t === "$mid")).toHaveLength(1)
  })

  test("collectContributions merges custom string aliases", () => {
    const c = collectContributions([copilotCliPlugin])
    expect(c.stringAliases.map((a) => a.name)).toContain("ModelId")
  })

  test("collectContributions merges parameters (last-wins)", () => {
    const a = { name: "a", contribute: () => ({ parameters: { "hoist-shared.min-keys": 5 } }) }
    const b = { name: "b", contribute: () => ({ parameters: { "hoist-shared.min-keys": 9 } }) }
    const c = collectContributions([a, b])
    expect(c.parameters["hoist-shared.min-keys"]).toBe(9)
  })

  test("collectContributions rejects unknown parameter key", () => {
    const p = { name: "bad", contribute: () => ({ parameters: { "bogus.key": 1 } }) }
    expect(() => collectContributions([p])).toThrow(/unknown parameter/)
  })
})

describe("resolvePluginNames", () => {
  test("resolves known names in order", () => {
    const r = resolvePluginNames(["vscode", "copilot-cli"])
    expect(r).toHaveLength(2)
    expect(r[0]).toBe(vscodePlugin)
    expect(r[1]).toBe(copilotCliPlugin)
  })

  test("empty list → empty result", () => {
    expect(resolvePluginNames([])).toEqual([])
  })

  test("throws on unknown name", () => {
    expect(() => resolvePluginNames(["bogus"])).toThrow(/unknown plugin "bogus"/)
  })

  test("error lists known built-ins", () => {
    expect(() => resolvePluginNames(["bogus"])).toThrow(/vscode/)
  })
})
