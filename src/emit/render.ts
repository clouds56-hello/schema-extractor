import type { Schema } from "@/ir/types"
import { ALIASES } from "@/ir/alias"
import { pickTagLiteral } from "@/ir/tags"
import {
  type PathCtx,
  EMPTY_CTX,
  descendArray,
  descendField,
  descendRecord,
  descendVariant,
  descendVariantFallback,
  indent,
  isSafeIdent,
  variantTypeName,
} from "./name"

// ---------- emit context ----------

export interface DeclEntry {
  name: string
  body: string
  doc: string[]
  oldChain: string
  ir: Schema & { k: "object" }
}

export interface EmitCtx {
  decls: DeclEntry[]
  used: Set<string>
  aliases: Set<string>
  objCache: Map<Schema, string>
  hoistedSet: Set<Schema>
  hoistName: Map<Schema, string>
}

export function makeEmitCtx(seedNames: Iterable<string> = []): EmitCtx {
  return {
    decls: [],
    used: new Set(seedNames),
    aliases: new Set(),
    objCache: new Map(),
    hoistedSet: new Set(),
    hoistName: new Map(),
  }
}

export function uniqueName(ctx: EmitCtx, base: string): string {
  let n = base
  let i = 2
  while (ctx.used.has(n)) n = `${base}_${i++}`
  ctx.used.add(n)
  return n
}

// ---------- render ----------

export function render(s: Schema, ctx: EmitCtx, p: PathCtx): string {
  switch (s.k) {
    case "never":
      return "never"
    case "any":
      return "unknown"
    case "prim": {
      const parts: string[] = []
      const lits = s.literals
      const nlits = s.numLiterals
      const hasString = s.types.has("string")
      const hasNumber = s.types.has("number")
      const onlyStringNonNull = hasString && !hasNumber && !s.types.has("boolean")
      if (hasString && lits && lits.size > 0) {
        for (const l of [...lits].sort()) parts.push(JSON.stringify(l))
      } else if (hasString) {
        let stringRepr = "string"
        if (onlyStringNonNull && s.seenString) {
          let picked: string | null = null
          for (const def of ALIASES) {
            if (s.aliasOnly?.get(def.name) !== true) continue
            if (def.evidence && s.aliasEvidence?.get(def.name) !== true) continue
            picked = def.name
            break
          }
          if (picked) {
            ctx.aliases.add(picked)
            stringRepr = picked
          } else if (s.minLen !== undefined && s.minLen > 50) {
            ctx.aliases.add("Blob")
            stringRepr = "Blob"
          }
        }
        parts.push(stringRepr)
      }
      if (hasNumber && nlits && nlits.size > 0) {
        for (const l of [...nlits].sort((x, y) => x - y)) parts.push(String(l))
      } else if (hasNumber) {
        parts.push("number")
      }
      if (s.types.has("boolean")) parts.push("boolean")
      if (s.types.has("null")) parts.push("null")
      return parts.length ? parts.join(" | ") : "never"
    }
    case "array": {
      const inner = render(s.item, ctx, descendArray(p))
      return needsParens(s.item) ? `Array<${inner}>` : `${inner}[]`
    }
    case "record": {
      const inner = render(s.value, ctx, descendRecord(p))
      if (s.key !== "string") ctx.aliases.add(s.key)
      return `Record<${s.key}, ${inner}>`
    }
    case "union": {
      const parts: string[] = []
      for (const v of s.variants) {
        if (v.k === "object") {
          const cached = ctx.objCache.get(v)
          if (cached) {
            parts.push(cached)
            continue
          }
          const tag = pickTagLiteral(v)
          const override = ctx.hoistName.get(v)
          const sub = tag ? descendVariant(p, tag.value) : descendVariantFallback(p)
          const baseName = override ?? (tag ? variantTypeName(p, String(tag.value)) : variantTypeName(p, "Variant"))
          const variantName = uniqueName(ctx, baseName)
          ctx.objCache.set(v, variantName)
          emitNamedObject(v, ctx, variantName, sub)
          parts.push(variantName)
        } else {
          parts.push(render(v, ctx, descendVariantFallback(p)))
        }
      }
      const seen = new Set<string>()
      const uniq = parts.filter((x) => (seen.has(x) ? false : (seen.add(x), true)))
      return uniq.join(" | ")
    }
    case "object": {
      if (ctx.hoistedSet.has(s)) {
        const cached = ctx.objCache.get(s)
        if (cached) return cached
        const override = ctx.hoistName.get(s)
        let baseName: string
        let sub: PathCtx
        if (override) {
          baseName = override
          sub = descendVariantFallback(p)
        } else {
          const tag = pickTagLiteral(s)
          sub = tag ? descendVariant(p, tag.value) : descendVariantFallback(p)
          baseName = tag ? variantTypeName(p, String(tag.value)) : variantTypeName(p, "Variant")
        }
        const variantName = uniqueName(ctx, baseName)
        ctx.objCache.set(s, variantName)
        emitNamedObject(s, ctx, variantName, sub)
        return variantName
      }
      return renderObjectInline(s, ctx, p)
    }
  }
}

export function needsParens(s: Schema): boolean {
  return s.k === "union" || (s.k === "prim" && s.types.size + (s.literals?.size ?? 0) + (s.numLiterals?.size ?? 0) > 1)
}

export function renderObjectInline(o: Schema & { k: "object" }, ctx: EmitCtx, p: PathCtx): string {
  if (o.props.size === 0) return "Record<string, unknown>"
  const lines: string[] = ["{"]
  const keys = [...o.props.keys()].sort()
  for (const key of keys) {
    const { schema, present } = o.props.get(key)!
    const optional = present < o.total ? "?" : ""
    const t = render(schema, ctx, descendField(p, key))
    const safe = isSafeIdent(key) ? key : JSON.stringify(key)
    lines.push(`  ${safe}${optional}: ${indent(t)};`)
  }
  lines.push("}")
  return lines.join("\n")
}

export function emitNamedObject(o: Schema & { k: "object" }, ctx: EmitCtx, name: string, p: PathCtx): void {
  const body = renderObjectInline(o, ctx, p)
  const doc = p.pretty ? [p.pretty] : []
  ctx.decls.push({ name, body, doc, oldChain: p.old, ir: o })
}

// ---------- dry render ----------

const _dryRenderCache = new WeakMap<object, string>()
export function dryRender(s: Schema): string {
  if (typeof s === "object" && s !== null) {
    const hit = _dryRenderCache.get(s)
    if (hit !== undefined) return hit
  }
  const tmp: EmitCtx = makeEmitCtx()
  const out = render(s, tmp, EMPTY_CTX)
  if (typeof s === "object" && s !== null) _dryRenderCache.set(s, out)
  return out
}
