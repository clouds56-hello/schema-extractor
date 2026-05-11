import { expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expandGlobs } from "@/input/glob"

test("expandGlobs: returns [] and warns when prefix dir does not exist", () => {
  // /tmp/__schema_extractor_no_match_zzz_* is guaranteed-absent; the glob
  // walk used to crash with ENOENT before the existsSync guard was added.
  const out = expandGlobs(["/tmp/__schema_extractor_no_match_zzz_xyz/**/*.jsonl"])
  expect(out).toEqual([])
})

test("expandGlobs: matches real files in a tmp dir", () => {
  const dir = mkdtempSync(join(tmpdir(), "sxglob-"))
  try {
    writeFileSync(join(dir, "a.jsonl"), "{}\n")
    writeFileSync(join(dir, "b.jsonl"), "{}\n")
    writeFileSync(join(dir, "c.txt"), "skip\n")
    const out = expandGlobs([`${dir}/*.jsonl`])
    expect(out.sort()).toEqual([join(dir, "a.jsonl"), join(dir, "b.jsonl")])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("expandGlobs: literal (non-glob) paths pass through unchanged", () => {
  const out = expandGlobs(["/some/literal/path.jsonl"])
  expect(out).toEqual(["/some/literal/path.jsonl"])
})
