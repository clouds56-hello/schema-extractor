import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { findManifest, loadManifest, parseManifest, resolveTargetPaths } from "@/manifest"

describe("parseManifest", () => {
  test("accepts minimal valid manifest", () => {
    const m = parseManifest(JSON.stringify({ targets: [{ name: "a", input: "x.jsonl", output: "a.d.ts" }] }))
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
    expect(() => parseManifest(JSON.stringify({ targets: [{ name: 1, input: "x", output: "y" }] }))).toThrow(/name/)
  })

  test("rejects bad input type", () => {
    expect(() => parseManifest(JSON.stringify({ targets: [{ name: "a", input: 7, output: "y" }] }))).toThrow(/input/)
  })

  test("rejects invalid JSON", () => {
    expect(() => parseManifest("not json")).toThrow(/JSON/)
  })

  test("options.plugins omitted → empty plugin list (opt-in semantics)", () => {
    const m = parseManifest(JSON.stringify({ targets: [{ name: "a", input: "x", output: "y" }] }))
    expect(m.targets[0]!.options?.plugins).toEqual([])
  })

  test("options.plugins resolves built-in names", () => {
    const m = parseManifest(
      JSON.stringify({ targets: [{ name: "a", input: "x", output: "y", options: { plugins: ["vscode"] } }] }),
    )
    const plugins = m.targets[0]!.options?.plugins
    expect(plugins).toHaveLength(1)
    expect(plugins?.[0]?.name).toBe("vscode")
  })

  test("options.plugins rejects unknown name with descriptive error", () => {
    expect(() =>
      parseManifest(
        JSON.stringify({ targets: [{ name: "a", input: "x", output: "y", options: { plugins: ["nope"] } }] }),
      ),
    ).toThrow(/unknown plugin "nope"/)
  })

  test("options.plugins rejects non-string-array", () => {
    expect(() =>
      parseManifest(
        JSON.stringify({ targets: [{ name: "a", input: "x", output: "y", options: { plugins: [1, 2] } }] }),
      ),
    ).toThrow(/plugins.*string/)
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

describe("schema-extractor.schema.json", () => {
  const repoRoot = resolve(__dirname, "..", "..")
  const schemaPath = join(repoRoot, "schema-extractor.schema.json")
  const manifestPath = join(repoRoot, "schema-extractor.json")

  test("schema file is valid JSON with expected shape", () => {
    const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as Record<string, unknown>
    expect(schema.type).toBe("object")
    const defs = schema.definitions as Record<string, unknown>
    expect(defs.Target).toBeDefined()
  })

  test("committed manifest references the schema", () => {
    const m = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>
    expect(m.$schema).toBe("./schema-extractor.schema.json")
  })

  test("committed manifest's target keys are all in the schema", () => {
    const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as {
      definitions: { Target: { properties: Record<string, unknown> } }
    }
    const allowed = new Set(Object.keys(schema.definitions.Target.properties))
    const m = parseManifest(readFileSync(manifestPath, "utf8"))
    for (const t of m.targets) {
      for (const k of Object.keys(t)) {
        expect(allowed.has(k)).toBe(true)
      }
    }
  })
})
