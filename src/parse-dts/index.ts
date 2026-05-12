// Tokenizer + parser for the narrow .d.ts grammar emitted by `src/emit/render.ts`.
// We do NOT support the full TypeScript grammar — only what we produce.

import type { Prim, Schema } from "@/ir/types"
import { NEVER } from "@/ir/types"

// ---------- tokens ----------

type Tok =
  | { t: "ident"; v: string }
  | { t: "str"; v: string }
  | { t: "num"; v: number }
  | { t: "punct"; v: string } // one of: { } [ ] < > ( ) , ; : | & = ? .
  | { t: "kw"; v: "export" | "type" }

const PUNCT = new Set(["{", "}", "[", "]", "<", ">", "(", ")", ",", ";", ":", "|", "&", "=", "?", "."])

export function tokenize(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]!
    // whitespace
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++
      continue
    }
    // line comment
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++
      continue
    }
    // block comment / doc comment
    if (c === "/" && src[i + 1] === "*") {
      i += 2
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++
      i += 2
      continue
    }
    // string literal (double or single quote)
    if (c === '"' || c === "'") {
      const quote = c
      i++
      let v = ""
      while (i < src.length && src[i] !== quote) {
        if (src[i] === "\\" && i + 1 < src.length) {
          const n = src[i + 1]!
          if (n === "n") v += "\n"
          else if (n === "t") v += "\t"
          else if (n === "r") v += "\r"
          else v += n
          i += 2
        } else {
          v += src[i]
          i++
        }
      }
      i++ // closing quote
      out.push({ t: "str", v })
      continue
    }
    // number literal (integer or float, allow leading -)
    if (c === "-" || (c >= "0" && c <= "9")) {
      const start = i
      if (c === "-") i++
      while (i < src.length && ((src[i]! >= "0" && src[i]! <= "9") || src[i] === ".")) i++
      out.push({ t: "num", v: Number(src.slice(start, i)) })
      continue
    }
    // identifier or keyword
    if (/[A-Za-z_$]/.test(c)) {
      const start = i
      while (i < src.length && /[A-Za-z0-9_$]/.test(src[i]!)) i++
      const v = src.slice(start, i)
      if (v === "export" || v === "type") out.push({ t: "kw", v })
      else out.push({ t: "ident", v })
      continue
    }
    // punctuation
    if (PUNCT.has(c)) {
      out.push({ t: "punct", v: c })
      i++
      continue
    }
    throw new Error(`tokenize: unexpected char ${JSON.stringify(c)} at offset ${i}`)
  }
  return out
}

// ---------- parser ----------

export interface ParsedDecl {
  name: string
  schema: Schema
}

export interface ParseDtsResult {
  decls: ParsedDecl[]
  /** Order-preserved list of decl names, for picking a default root (last is conventional). */
  order: string[]
}

class Parser {
  pos = 0
  constructor(public toks: Tok[]) {}

  peek(off = 0): Tok | undefined {
    return this.toks[this.pos + off]
  }
  next(): Tok {
    const t = this.toks[this.pos]
    if (!t) throw new Error("parser: unexpected end of input")
    this.pos++
    return t
  }
  eat(t: Tok["t"], v?: string): Tok {
    const tok = this.next()
    if (tok.t !== t || (v !== undefined && (tok as { v: unknown }).v !== v)) {
      throw new Error(`parser: expected ${t}${v ? ` "${v}"` : ""}, got ${JSON.stringify(tok)}`)
    }
    return tok
  }
  match(t: Tok["t"], v?: string): boolean {
    const tok = this.peek()
    if (!tok || tok.t !== t) return false
    if (v !== undefined && (tok as { v: unknown }).v !== v) return false
    return true
  }

  parseProgram(): ParsedDecl[] {
    const out: ParsedDecl[] = []
    while (this.pos < this.toks.length) {
      out.push(this.parseDecl())
    }
    return out
  }

  parseDecl(): ParsedDecl {
    this.eat("kw", "export")
    this.eat("kw", "type")
    const nameTok = this.eat("ident")
    this.eat("punct", "=")
    const schema = this.parseUnion()
    if (this.match("punct", ";")) this.next()
    return { name: nameTok.v as string, schema }
  }

  /** Parse a union: `T | T | T`. Leading bar tolerated. */
  parseUnion(): Schema {
    if (this.match("punct", "|")) this.next()
    const variants: Schema[] = [this.parsePostfix()]
    while (this.match("punct", "|")) {
      this.next()
      variants.push(this.parsePostfix())
    }
    if (variants.length === 1) return variants[0]!
    return collapseUnion(variants)
  }

  /** Parse `Atom ([])* `. Trailing `[]` → array wrapping. */
  parsePostfix(): Schema {
    let s = this.parseAtom()
    while (this.match("punct", "[")) {
      this.next()
      this.eat("punct", "]")
      s = { k: "array", item: s }
    }
    return s
  }

  parseAtom(): Schema {
    const tok = this.peek()
    if (!tok) throw new Error("parser: expected atom, got end of input")

    if (tok.t === "str") {
      this.next()
      return { k: "prim", types: new Set(["string"]), literals: new Set([tok.v as string]) }
    }
    if (tok.t === "num") {
      this.next()
      return { k: "prim", types: new Set(["number"]), numLiterals: new Set([tok.v as number]) }
    }
    if (tok.t === "punct" && tok.v === "{") {
      return this.parseObject()
    }
    if (tok.t === "punct" && tok.v === "(") {
      this.next()
      const inner = this.parseUnion()
      this.eat("punct", ")")
      return inner
    }
    if (tok.t === "ident") {
      this.next()
      const name = tok.v as string
      // primitives & specials
      if (name === "string" || name === "number" || name === "boolean") {
        return { k: "prim", types: new Set([name as Prim]) }
      }
      if (name === "null") return { k: "prim", types: new Set(["null"]) }
      if (name === "true" || name === "false") return { k: "prim", types: new Set(["boolean"]) }
      if (name === "never") return { ...NEVER }
      if (name === "unknown" || name === "any") return { k: "any" }
      // generics: Array<T>, Record<K, V>
      if (this.match("punct", "<")) {
        this.next()
        const args: Schema[] = [this.parseUnion()]
        while (this.match("punct", ",")) {
          this.next()
          args.push(this.parseUnion())
        }
        this.eat("punct", ">")
        if (name === "Array") return { k: "array", item: args[0]! }
        if (name === "Record") {
          const keyName = aliasNameOf(args[0]!)
          return { k: "record", key: keyName ?? "string", value: args[1]! }
        }
        // unknown generic — treat as named ref ignoring args
        return { k: "named-ref", name } as unknown as Schema
      }
      return { k: "named-ref", name } as unknown as Schema
    }
    throw new Error(`parser: unexpected token ${JSON.stringify(tok)}`)
  }

  parseObject(): Schema {
    this.eat("punct", "{")
    const props = new Map<string, { schema: Schema; present: number }>()
    const total = 1
    while (!this.match("punct", "}")) {
      const keyTok = this.next()
      let key: string
      if (keyTok.t === "ident") key = keyTok.v as string
      else if (keyTok.t === "kw") key = keyTok.v as string
      else if (keyTok.t === "str") key = keyTok.v as string
      else throw new Error(`parser: expected object key, got ${JSON.stringify(keyTok)}`)
      let optional = false
      if (this.match("punct", "?")) {
        this.next()
        optional = true
      }
      this.eat("punct", ":")
      const schema = this.parseUnion()
      // optional members shown as "?: T;"  → represent as present=0/total=1; renderer compares.
      props.set(key, { schema, present: optional ? 0 : 1 })
      // total/present semantics: optional → present < total; non-optional → present === total.
      if (this.match("punct", ";")) this.next()
      else if (this.match("punct", ",")) this.next()
    }
    this.eat("punct", "}")
    return { k: "object", total, props }
  }
}

function aliasNameOf(s: Schema): string | undefined {
  const ref = s as unknown as { k: string; name?: string }
  if (ref.k === "named-ref") return ref.name
  return undefined
}

/** Collapse adjacent prim variants (e.g. `string | number | null`) into a single prim node. */
function collapseUnion(variants: Schema[]): Schema {
  // Merge adjacent pure-prim variants
  const acc: Schema & { k: "prim" } = { k: "prim", types: new Set() }
  let hasAcc = false
  const others: Schema[] = []
  for (const v of variants) {
    if (v.k === "prim") {
      hasAcc = true
      for (const t of v.types) acc.types.add(t)
      if (v.literals) {
        acc.literals = acc.literals ?? new Set()
        for (const l of v.literals) acc.literals.add(l)
      }
      if (v.numLiterals) {
        acc.numLiterals = acc.numLiterals ?? new Set()
        for (const n of v.numLiterals) acc.numLiterals.add(n)
      }
    } else {
      others.push(v)
    }
  }
  const final: Schema[] = []
  if (hasAcc) final.push(acc)
  final.push(...others)
  if (final.length === 1) return final[0]!
  return { k: "union", variants: final }
}

// ---------- ref resolution ----------

/**
 * In the parsed IR we use a synthetic `{ k: "named-ref", name }` placeholder
 * for type identifiers. After parsing all decls, resolve refs:
 *   - alias decls (`type Foo = string;`) → inline the prim
 *   - object/union decls → leave as a `name` reference, OR inline if the caller wants a flattened tree.
 *
 * Strategy: build a name→schema map; treat refs to "alias-only primitives" as inlining the primitive;
 * refs to objects/unions stay as opaque (we wrap them in a `prim` of kind never with a brand?).
 *
 * Simpler model used here: returns map of name→resolved Schema, with all refs replaced by the
 * referenced schema (recursive types are detected and broken with `any`).
 */
export function resolveRefs(decls: ParsedDecl[]): ParsedDecl[] {
  const byName = new Map(decls.map((d) => [d.name, d.schema]))
  const resolving = new Set<string>()

  function resolve(s: Schema): Schema {
    const ref = s as unknown as { k: string; name?: string }
    if (ref.k === "named-ref") {
      const target = byName.get(ref.name!)
      if (!target) {
        // Unknown identifier — treat as opaque string for safety.
        return { k: "any" }
      }
      if (resolving.has(ref.name!)) {
        // Recursive — break the cycle with any.
        return { k: "any" }
      }
      resolving.add(ref.name!)
      const out = resolve(target)
      resolving.delete(ref.name!)
      return out
    }
    if (s.k === "array") return { k: "array", item: resolve(s.item) }
    if (s.k === "record") return { k: "record", key: s.key, value: resolve(s.value) }
    if (s.k === "union") return { k: "union", variants: s.variants.map(resolve) }
    if (s.k === "object") {
      const props = new Map<string, { schema: Schema; present: number }>()
      for (const [k, p] of s.props) props.set(k, { schema: resolve(p.schema), present: p.present })
      return { k: "object", total: s.total, props }
    }
    return s
  }

  return decls.map((d) => {
    resolving.add(d.name)
    const out = { name: d.name, schema: resolve(d.schema) }
    resolving.delete(d.name)
    return out
  })
}

// ---------- public ----------

export function parseDts(src: string): ParseDtsResult {
  const toks = tokenize(src)
  const parser = new Parser(toks)
  const decls = parser.parseProgram()
  const resolved = resolveRefs(decls)
  return { decls: resolved, order: decls.map((d) => d.name) }
}
