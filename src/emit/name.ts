// Path / name helpers used by the renderer.

import { createHash } from "node:crypto"

export interface PathCtx {
  /** PascalCase chain — only used for hashing. */
  old: string
  /** Human-readable path: "EventMsg.payload -> ExecCommandEnd.parsed_cmd[] -> ListFiles". */
  pretty: string
  /** Most recent JSON field name encountered ("" if none yet). */
  field: string
}

export const ROOT_CTX = (rootName: string): PathCtx => ({ old: rootName, pretty: "", field: "" })
export const EMPTY_CTX: PathCtx = { old: "", pretty: "", field: "" }

export function pascal(s: string): string {
  return (
    s
      .replace(/[^a-zA-Z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : ""))
      .join("") || "Variant"
  )
}

export function isSafeIdent(k: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k)
}

export function child(parent: string, seg: string): string {
  if (!parent) return seg
  return `${parent}_${seg}`
}

export function descendField(p: PathCtx, key: string): PathCtx {
  return {
    old: child(p.old, pascal(key)),
    pretty: p.pretty ? `${p.pretty}.${key}` : key,
    field: key,
  }
}

export function descendVariant(p: PathCtx, tagValue: string | number): PathCtx {
  const sv = String(tagValue)
  const seg = pascal(sv)
  return {
    old: child(p.old, seg),
    pretty: p.pretty ? `${p.pretty} -> ${sv}` : sv,
    field: p.field,
  }
}

export function descendArray(p: PathCtx): PathCtx {
  return { old: child(p.old, "Item"), pretty: `${p.pretty}[]`, field: p.field }
}

export function descendRecord(p: PathCtx): PathCtx {
  return { old: child(p.old, "Value"), pretty: `${p.pretty}{}`, field: p.field }
}

export function descendVariantFallback(p: PathCtx): PathCtx {
  return {
    old: child(p.old, "Variant"),
    pretty: p.pretty ? `${p.pretty} -> Variant` : "Variant",
    field: p.field,
  }
}

export function sha8(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 8)
}

export function variantTypeName(p: PathCtx, leaf: string): string {
  const hash = sha8(child(p.old, leaf))
  const leafSeg = pascal(leaf)
  const fieldSeg = p.field ? pascal(p.field) : ""
  const raw = fieldSeg ? `${fieldSeg}_${leafSeg}_${hash}` : `${leafSeg}_${hash}`
  return /^[0-9]/.test(raw) ? `$${raw}` : raw
}

export function indent(s: string): string {
  return s.replace(/\n/g, "\n  ")
}
