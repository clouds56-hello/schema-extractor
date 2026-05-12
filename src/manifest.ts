/**
 * Build manifest: `schema-extractor.json` declares one or more *targets*,
 * each producing a single `.d.ts` from one or more JSONL globs. The CLI
 * (`schema-extractor gen` with no positional args) and the integration
 * test harness both consume this file, so it is the single source of
 * truth for "which inputs generate which outputs".
 */
import { existsSync, readFileSync } from "node:fs"
import { dirname, isAbsolute, resolve } from "node:path"
import type { ExtractorOptions } from "./config"

export interface Target {
  /** Stable identifier for logging / test naming. */
  name: string
  /** One or more JSONL globs (`~` and `**` supported). */
  input: string | readonly string[]
  /** Path the generated `.d.ts` is written to. Resolved relative to the manifest. */
  output: string
  /** Per-target ExtractorOptions overrides. CLI flags still win. */
  options?: ExtractorOptions
}

export interface Manifest {
  $schema?: string
  targets: readonly Target[]
}

export const MANIFEST_FILENAME = "schema-extractor.json"

/**
 * Walk up from `start` looking for `schema-extractor.json`. Returns the
 * absolute path of the first match, or `null` if none found before the
 * filesystem root.
 */
export function findManifest(start: string = process.cwd()): string | null {
  let dir = resolve(start)
  for (;;) {
    const candidate = resolve(dir, MANIFEST_FILENAME)
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

function isStringArray(v: unknown): v is readonly string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string")
}

function validateTarget(t: unknown, idx: number): Target {
  if (typeof t !== "object" || t === null) {
    throw new Error(`manifest.targets[${idx}]: expected object`)
  }
  const o = t as Record<string, unknown>
  if (typeof o.name !== "string" || !o.name) {
    throw new Error(`manifest.targets[${idx}].name: expected non-empty string`)
  }
  if (typeof o.output !== "string" || !o.output) {
    throw new Error(`manifest.targets[${idx}].output: expected non-empty string`)
  }
  if (typeof o.input !== "string" && !isStringArray(o.input)) {
    throw new Error(`manifest.targets[${idx}].input: expected string or string[]`)
  }
  if (o.options !== undefined && (typeof o.options !== "object" || o.options === null)) {
    throw new Error(`manifest.targets[${idx}].options: expected object`)
  }
  const target: Target = {
    name: o.name,
    input: o.input as string | readonly string[],
    output: o.output,
  }
  if (o.options !== undefined) target.options = o.options as ExtractorOptions
  return target
}

/** Parse + validate manifest text. Throws with a descriptive message on failure. */
export function parseManifest(text: string): Manifest {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (e) {
    throw new Error(`manifest: invalid JSON: ${(e as Error).message}`)
  }
  if (typeof json !== "object" || json === null) {
    throw new Error("manifest: expected object at top level")
  }
  const o = json as Record<string, unknown>
  if (!Array.isArray(o.targets)) {
    throw new Error("manifest.targets: expected array")
  }
  const targets = o.targets.map(validateTarget)
  const m: Manifest = { targets }
  if (typeof o.$schema === "string") m.$schema = o.$schema
  return m
}

/** Read + parse the manifest file. */
export function loadManifest(path: string): Manifest {
  const text = readFileSync(path, "utf8")
  return parseManifest(text)
}

/** Resolve a target's `output` and `input` paths relative to the manifest dir. */
export function resolveTargetPaths(target: Target, manifestPath: string): { output: string; input: readonly string[] } {
  const baseDir = dirname(resolve(manifestPath))
  const inputs = (typeof target.input === "string" ? [target.input] : target.input).map((p) => {
    // Tilde-expansion is handled by expandGlobs at consume-time; only resolve
    // bare relative paths against the manifest dir.
    if (p.startsWith("~") || isAbsolute(p)) return p
    return resolve(baseDir, p)
  })
  const output = isAbsolute(target.output) ? target.output : resolve(baseDir, target.output)
  return { output, input: inputs }
}
