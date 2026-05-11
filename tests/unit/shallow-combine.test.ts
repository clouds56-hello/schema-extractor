import { describe, expect, test } from "bun:test"
import { extractSchema } from "@/index"

/**
 * Regression for the v7 fix in `src/policy/combine.ts` `case "shallow"`:
 * when the `field-tag` consolidation pass buckets two objects sharing
 * (parentField, tagKey, tagValue), prim props are merged BUT non-prim props
 * with structurally-different incoming schemas must also be deep-merged.
 *
 * Before the fix, `combineInto` silently kept `existing.schema` for any
 * non-prim prop (only `prim.types`/`literals` flowed through), so divergent
 * `content` shapes across files collapsed to whichever was seen first.
 *
 * Reproduces the copilot-chat `progressTaskSerialized.content` collapse:
 * two `kind: "pts"` records with structurally different `content` objects
 * must produce a UNION (not just one variant) for `content`.
 */
describe("regression: shallow-combine preserves divergent non-prim props", () => {
  test("tag-bucketed objects union differing nested object shapes", () => {
    // Wrapping in `response[]` reproduces the (parentField=response, tagKey=kind)
    // bucketing path used by the field-tag pass.
    const ts = extractSchema(
      [
        { response: [{ kind: "pts", content: { value: "x", uris: {} } }] },
        { response: [{ kind: "other", x: 1 }] },
        {
          response: [
            { kind: "pts", content: { value: "y", isTrusted: true, supportThemeIcons: false } },
          ],
        },
      ],
      { rootName: "Evt" },
    )
    // Both content shapes survive as variants in a union (key signal: `uris`
    // appears in one shape, `isTrusted` in the other).
    expect(ts).toContain("uris:")
    expect(ts).toContain("isTrusted:")
    // And `content` is a union (`|`), not a single object.
    expect(ts).toMatch(/content:[^;]*\|/)
  })
})
