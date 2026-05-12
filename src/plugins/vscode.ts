import type { Schema } from "@/ir/types"
import type { NamePlugin, PluginCtx, PluginMatch } from "./types"

/**
 * VSCode-aware plugin. Encodes knowledge about VSCode's marshalling protocol
 * (`$mid` = marshalling-id, see `vs/base/common/marshalling.ts`) and well-known
 * shapes that recur across copilot-chat session JSONL.
 *
 * The mapping table below is grounded in observed shapes from real session
 * captures. It is intentionally narrow: each entry requires the exact `$mid`
 * literal to match, never a generic "object with $mid" predicate.
 *
 * Source of $mid IDs: VSCode source tree at `vs/base/common/marshalling.ts`
 * (and per-class overrides in language-model parts). IDs are stable across
 * VSCode releases; new ones may be added but existing ones don't shift.
 */

interface MidEntry {
  mid: number
  name: string
}

// Well-known $mid values. Add new entries only with evidence from a real
// JSONL sample, never speculatively.
const MID_TABLE: readonly MidEntry[] = [
  { mid: 1, name: "VscodeUri" },
  { mid: 20, name: "VscodeLanguageModelToolResult" },
  { mid: 21, name: "VscodeLanguageModelTextPart" },
  { mid: 23, name: "VscodeLanguageModelPromptTsxPart" },
]

const MID_BY_VALUE = new Map<number, string>(MID_TABLE.map((e) => [e.mid, e.name]))

function pickMidLiteral(s: Schema & { k: "object" }): number | null {
  const prop = s.props.get("$mid")
  if (!prop || prop.schema.k !== "prim") return null
  const lits = prop.schema.numLiterals
  if (!lits || lits.size !== 1) return null
  const [v] = [...lits]
  return typeof v === "number" ? v : null
}

export const vscodePlugin: NamePlugin = {
  name: "vscode",

  contribute() {
    return {
      // `$mid` is VSCode's marshalling discriminator. Treat it as a global
      // tag key so `tag-hints` consolidates all `{$mid: N, ...}` objects
      // sharing the same N into a single decl.
      multiTagHints: ["$mid"],
      // Empirical: copilot-chat surfaces two object shapes whose alias-keyed
      // children-arrays look structurally compatible but differ on detail.
      // Hint the merger to fold them.
      dedupHints: [
        ["CopilotChat_1_V_Variant_Metadata_ToolCallResults_Value_Content", "Children_1"],
        ["CopilotChat_1_V_Variant_Metadata_ToolCallResults_Value_Content", "Children_2"],
      ],
      // `UserSelectedTools` is a VSCode-side map; collapse to Record<string, V>
      // rather than open-ended object enumeration.
      recordHints: ["UserSelectedTools"],
    }
  },

  match(ir: Schema, _ctx: PluginCtx): PluginMatch | null {
    if (ir.k !== "object") return null
    const mid = pickMidLiteral(ir)
    if (mid === null) return null
    const name = MID_BY_VALUE.get(mid)
    if (!name) return null
    return { name, hoist: true }
  },
}
