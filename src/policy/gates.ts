import type { Schema } from "@/ir/types"
import { TAG_CANDIDATES } from "@/ir/types"
import { compatibleForMerge, pickTagKey, pickTagLiteral } from "@/ir/tags"
import { runtime } from "@/runtime"
import type { GateKind } from "./types"

export function gateAccepts(a: Schema, b: Schema, gate: GateKind): boolean {
  switch (gate) {
    case "any":
      return true
    case "tag-strict":
      return compatibleForMerge(a, b)
    case "tag-present": {
      if (a.k !== "object" || b.k !== "object") return false
      return pickTagKey(a) !== null && pickTagKey(b) !== null
    }
    case "tag-loose": {
      if (a.k !== "object" || b.k !== "object") return true
      const ta = pickTagLiteral(a)
      const tb = pickTagLiteral(b)
      if (!ta || !tb) return false
      return ta.key === tb.key && ta.value === tb.value
    }
    case "no-tag": {
      if (a.k !== "object" || b.k !== "object") return false
      const isTagKey = (k: string) => (TAG_CANDIDATES as readonly string[]).includes(k) || k === runtime.userTagKey
      for (const k of a.props.keys()) if (isTagKey(k)) return false
      for (const k of b.props.keys()) if (isTagKey(k)) return false
      return true
    }
    case "name-prefix":
      return true
  }
}
