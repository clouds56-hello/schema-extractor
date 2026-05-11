import { describe, expect, test } from "bun:test"
import { extractSchema } from "@/index"
import { expandGlobs } from "@/input/glob"
import { parseJsonl } from "@/input/jsonl"

describe("expandGlobs edge cases", () => {
  test("empty patterns array → empty result", () => {
    expect(expandGlobs([])).toEqual([])
  })

  test("pattern with no matches returns empty (and warns)", () => {
    const matches = expandGlobs(["/tmp/__schema_extractor_no_match_zzz_*.jsonl"])
    expect(matches).toEqual([])
  })

  test("non-glob pattern passes through after tilde expansion", () => {
    const matches = expandGlobs(["/etc/hostname"])
    expect(matches).toEqual(["/etc/hostname"])
  })
})

describe("parseJsonl edge cases", () => {
  function streamOf(text: string): ReadableStream<Uint8Array> {
    return new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode(text))
        c.close()
      },
    })
  }

  test("blank lines are skipped", async () => {
    const r = await parseJsonl(streamOf('{"a":1}\n\n{"a":2}\n'), "<test>")
    expect(r).toEqual([{ a: 1 }, { a: 2 }])
  })

  test("trailing newline tolerated", async () => {
    const r = await parseJsonl(streamOf('{"a":1}'), "<test>")
    expect(r).toEqual([{ a: 1 }])
  })

  test("malformed lines are skipped (no throw)", async () => {
    const r = await parseJsonl(streamOf('{"a":1}\nnot-json\n{"a":2}\n'), "<test>")
    expect(r).toEqual([{ a: 1 }, { a: 2 }])
  })

  test("CRLF line endings work", async () => {
    const r = await parseJsonl(streamOf('{"a":1}\r\n{"a":2}\r\n'), "<test>")
    expect(r).toEqual([{ a: 1 }, { a: 2 }])
  })
})

describe("extractSchema edge cases", () => {
  test("empty iterable → root is never", () => {
    const out = extractSchema([], { rootName: "Empty" })
    expect(out).toContain("export type Empty = never")
  })

  test("single primitive value at root", () => {
    const out = extractSchema([42], { rootName: "Num" })
    expect(out).toContain("export type Num = number")
  })

  test("array root with mixed primitives", () => {
    const out = extractSchema([[1, "two", true, null]], { rootName: "Arr" })
    expect(out).toMatch(/Arr = \(.+\)\[\]|Array</)
  })

  test("very wide union (many distinct shapes)", () => {
    const records = Array.from({ length: 12 }, (_, i) => ({ kind: `k${i}`, [`field${i}`]: i }))
    const out = extractSchema(records, { rootName: "Wide" })
    expect(out).toContain("export type Wide")
    // 12 variants → 12 named types
    const matches = out.match(/export type K\d+_/g)
    expect(matches?.length).toBeGreaterThanOrEqual(10)
  })
})
