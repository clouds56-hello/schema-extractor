import { describe, expect, test } from "bun:test"
import { PIPELINE_PHASE_NAMES } from "@/passes/pipeline"

describe("pipeline", () => {
  // Phase order is documented in agents.md § Pipeline. Reordering breaks
  // golden fixtures; lock the order in here so accidental reshuffles in
  // pipeline.ts trip a fast unit test before the goldens diff.
  test("canonical phase order", () => {
    expect(PIPELINE_PHASE_NAMES).toEqual([
      "recordify",
      "hint-dedup",
      "auto-recursive",
      "field-tag",
      "tag-hints",
      "inline-unify",
      "inline-samekeys",
      "structural-dedupe",
    ])
  })
})
