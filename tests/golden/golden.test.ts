/**
 * Golden-snapshot test runner. Discovers `tests/golden/cases/*.case.ts` files;
 * each case exports `name`, `input` (string of JSONL), and optional `options`.
 * The expected output lives at `tests/golden/expected/<name>.d.ts`. Set
 * `UPDATE_GOLDEN=1` to (re)write the expected files.
 */
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { extractSchemaFromStream } from "@/index"
import type { ExtractorOptions } from "@/config"

interface Case {
  name: string
  input: string
  options?: ExtractorOptions
}

const HERE = dirname(new URL(import.meta.url).pathname)
const CASES_DIR = join(HERE, "cases")
const EXPECTED_DIR = join(HERE, "expected")
const UPDATE = process.env.UPDATE_GOLDEN === "1"

if (!existsSync(EXPECTED_DIR)) mkdirSync(EXPECTED_DIR, { recursive: true })

async function runCase(c: Case): Promise<string> {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(c.input))
      controller.close()
    },
  })
  return extractSchemaFromStream(stream, c.options ?? {}, c.name)
}

const files = existsSync(CASES_DIR)
  ? readdirSync(CASES_DIR)
      .filter((f) => f.endsWith(".case.ts"))
      .sort()
  : []

describe("golden", () => {
  for (const file of files) {
    test(file, async () => {
      const mod = (await import(join(CASES_DIR, file))) as Case
      const actual = await runCase(mod)
      const expectedPath = join(EXPECTED_DIR, `${mod.name}.d.ts`)
      if (UPDATE) {
        writeFileSync(expectedPath, actual)
        return
      }
      if (!existsSync(expectedPath)) {
        throw new Error(`missing golden ${expectedPath}; run with UPDATE_GOLDEN=1`)
      }
      const expected = readFileSync(expectedPath, "utf8")
      expect(actual).toBe(expected)
    })
  }
})
