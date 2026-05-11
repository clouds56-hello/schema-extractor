import type { HoistMeta } from "../emit/hoist.js";
import type { Schema } from "../ir/types.js";
import type { PickerKind } from "./types.js";

export function pickCanonIndex(group: HoistMeta[], pick: PickerKind, target?: Schema & { k: "object" }): number {
  if (group.length === 1) return 0;
  switch (pick) {
    case "first":
      return 0;
    case "shortest-name": {
      let best = 0;
      for (let i = 1; i < group.length; i++) {
        const cur = group[i]!;
        const winner = group[best]!;
        if (cur.oldChain.length < winner.oldChain.length) { best = i; continue; }
        if (cur.oldChain.length === winner.oldChain.length && cur.pretty < winner.pretty) best = i;
      }
      return best;
    }
    case "most-fields": {
      let best = 0;
      for (let i = 1; i < group.length; i++) {
        if (group[i]!.ir.props.size > group[best]!.ir.props.size) best = i;
      }
      return best;
    }
    case "highest-occur":
      return 0;
    case "max-overlap": {
      if (!target) return 0;
      const tk = new Set(target.props.keys());
      let best = 0;
      let bestOverlap = -1;
      for (let i = 0; i < group.length; i++) {
        let n = 0;
        for (const k of group[i]!.ir.props.keys()) if (tk.has(k)) n++;
        if (n > bestOverlap) { bestOverlap = n; best = i; }
      }
      return best;
    }
  }
}
