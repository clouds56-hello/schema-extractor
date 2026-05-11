#!/usr/bin/env bun
/**
 * One-shot import migration:
 *   - strip trailing `.js` from import specifiers
 *   - inside src/<folder>/: rewrite `../<other>/x` → `@/<other>/x`
 *     (relative siblings `./x` left alone)
 *   - outside src/: rewrite any specifier that resolves into src/ to `@/...`
 */
import { readdirSync, statSync, readFileSync, writeFileSync } from "node:fs"
import { join, dirname, relative, resolve } from "node:path"

const ROOT = resolve(import.meta.dir, "..")
const SRC = join(ROOT, "src")

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (p.endsWith(".ts")) out.push(p)
  }
  return out
}

const files = ["src", "tests", "bin", "scripts"].flatMap((d) => walk(join(ROOT, d)))

const SPEC_RE = /(from\s+|import\s*\(\s*)(["'])([^"']+)\2/g

function rewriteSpec(file: string, spec: string): string {
  // strip .js
  let s = spec.endsWith(".js") ? spec.slice(0, -3) : spec
  // strip .ts (defensive)
  if (s.endsWith(".ts")) s = s.slice(0, -3)

  if (s.startsWith("@/") || !s.startsWith(".")) return s

  const fileDir = dirname(file)
  const target = resolve(fileDir, s)
  const insideSrc = target.startsWith(SRC + "/") || target === SRC

  if (!insideSrc) return s

  if (file.startsWith(SRC + "/")) {
    // src→src: keep ./sibling, rewrite ../other → @/other
    if (s.startsWith("./")) return s
    // it's ../...; rewrite to @/<rel-from-src>
    return "@/" + relative(SRC, target)
  }

  // outside-src → src: always @/
  return "@/" + relative(SRC, target)
}

let changed = 0
for (const f of files) {
  const orig = readFileSync(f, "utf8")
  const next = orig.replace(SPEC_RE, (_m, kw, q, spec) => `${kw}${q}${rewriteSpec(f, spec)}${q}`)
  if (next !== orig) {
    writeFileSync(f, next)
    changed++
  }
}
console.error(`migrated imports in ${changed}/${files.length} files`)
