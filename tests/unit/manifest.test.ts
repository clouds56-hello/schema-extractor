import { describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { findManifest, loadManifest, parseManifest, resolveTargetPaths } from "@/manifest"

describe("parseManifest", () => {
  test("accepts minimal valid manifest", () => {
    const m = parseManifest(
      JSON.stringify({ targets: [{ name: "a", input: "x.jsonl", output: "a.d.ts" }] }),
    )
    expect(m.targets).toHaveLength(1)
    expect(m.targets[0]!.name).toBe("a")
  })

  test("accepts string[] for input", () => {
    const m = parseManifest(
      JSON.stringify({ targets: [{ name: "a", input: ["x.jsonl", "y.jsonl"], output: "a.d.ts" }] }),
    )
    expect(m.targets[0]!.input).toEqual(["x.jsonl", "y.jsonl"])
  })

  test("preserves $schema and options", () => {
    const m = parseManifest(
      JSON.stringify({
        $schema: "./s.json",
        targets: [{ name: "a", input: "x", output: "a.d.ts", options: { rootName: "Foo" } }],
      }),
    )
    expect(m.$schema).toBe("./s.json")
    expect(m.targets[0]!.options?.rootName).toBe("Foo")
  })

  test("rejects missing targets", () => {
    expect(() => parseManifest("{}")).toThrow(/targets/)
  })

  test("rejects non-string name", () => {
    expect(() =>
      parseManifest(JSON.stringify({ targets: [{ name: 1, input: "x", output: "y" }] })),
    ).toThrow(/name/)
  })

  test("rejects bad input type", () => {
    expect(() =>
      parseManifest(JSON.stringify({ targets: [{ name: "a", input: 7, output: "y" }] })),
    ).toThrow(/input/)
  })

  test("rejects invalid JSON", () => {
    expect(() => parseManifest("not json")).toThrow(/JSON/)
  })
})

describe("findManifest + loadManifest", () => {
  test("walks up to find manifest", () => {
    const root = mkdtempSync(join(tmpdir(), "se-mf-"))
    const nested = join(root, "a", "b", "c")
    mkdirSync(nested, { recursive: true })
    writeFileSync(
      join(root, "schema-extractor.json"),
      JSON.stringify({ targets: [{ name: "x", input: "i", output: "o.d.ts" }] }),
    )
    const found = findManifest(nested)
    expect(found).toBe(join(root, "schema-extractor.json"))
    const m = loadManifest(found!)
    expect(m.targets[0]!.name).toBe("x")
  })

  test("returns null when no manifest exists", () => {
    const root = mkdtempSync(join(tmpdir(), "se-mf-empty-"))
    expect(findManifest(root)).toBeNull()
  })
})

describe("resolveTargetPaths", () => {
  test("resolves relative paths against manifest dir", () => {
    const r = resolveTargetPaths(
      { name: "x", input: "data.jsonl", output: "out/x.d.ts" },
      "/tmp/proj/schema-extractor.json",
    )
    expect(r.output).toBe("/tmp/proj/out/x.d.ts")
    expect(r.input).toEqual(["/tmp/proj/data.jsonl"])
  })

  test("preserves tilde and absolute paths", () => {
    const r = resolveTargetPaths(
      { name: "x", input: ["~/data/*.jsonl", "/abs/path.jsonl"], output: "/abs/out.d.ts" },
      "/tmp/proj/schema-extractor.json",
    )
    expect(r.input).toEqual(["~/data/*.jsonl", "/abs/path.jsonl"])
    expect(r.output).toBe("/abs/out.d.ts")
  })
})
