/**
 * Configurable numeric parameters for pipeline passes.
 *
 * Single flat namespace, kebab-case keys formatted as `<pass>.<param>`. Adding
 * a new tunable requires:
 *   1. Add it to `DEFAULT_PARAMETERS` below (this is the source of truth for
 *      `KNOWN_PARAMETER_KEYS`).
 *   2. Read it at the call site via `params["<pass>.<param>"]`.
 *   3. Document it in `agents.md` § Parameters and in the JSON schema's
 *      `propertyNames.enum` for `options.parameters`.
 *
 * Precedence (highest wins): CLI `--param` > manifest `options.parameters` >
 * plugin contributions > `DEFAULT_PARAMETERS`.
 */

export type Parameters = Readonly<Record<string, number>>

/**
 * Exhaustive map of all known parameters with their built-in defaults. The
 * key set here defines what is accepted by `mergeParameters`,
 * `parseParameterPair`, and the manifest validator.
 */
export const DEFAULT_PARAMETERS: Parameters = Object.freeze({
  "hoist-shared.min-keys": 2,
  "hoist-shared.min-refs": 2,
  "pipeline.convergence-cap": 4,
  "structural-dedupe.max-passes": 16,
  "check.failure-cap": 20,
})

export const KNOWN_PARAMETER_KEYS: ReadonlySet<string> = new Set(Object.keys(DEFAULT_PARAMETERS))

function knownList(): string {
  return [...KNOWN_PARAMETER_KEYS].sort().join(", ")
}

/**
 * Merge a partial override onto a base parameter map. Validates that every
 * override key is in `KNOWN_PARAMETER_KEYS` and every value is a finite
 * non-negative integer. Throws on first violation with a descriptive message.
 *
 * Returns a new frozen map; inputs are not mutated.
 */
export function mergeParameters(base: Parameters, override: Readonly<Record<string, number>> | undefined): Parameters {
  if (!override) return base
  const out: Record<string, number> = { ...base }
  for (const [k, v] of Object.entries(override)) {
    if (!KNOWN_PARAMETER_KEYS.has(k)) {
      throw new Error(`unknown parameter "${k}". Known: ${knownList()}`)
    }
    if (!Number.isFinite(v) || !Number.isInteger(v) || v < 0) {
      throw new Error(`parameter "${k}": expected non-negative integer, got ${String(v)}`)
    }
    out[k] = v
  }
  return Object.freeze(out)
}

/**
 * Parse a single CLI `--param key=value` argument. Returns `[key, value]`.
 * Throws on bad syntax, unknown key, or non-integer value.
 */
export function parseParameterPair(s: string): readonly [string, number] {
  const idx = s.indexOf("=")
  if (idx <= 0 || idx === s.length - 1) {
    throw new Error(`--param expects "key=value", got: ${s}`)
  }
  const key = s.slice(0, idx).trim()
  const rawVal = s.slice(idx + 1).trim()
  if (!KNOWN_PARAMETER_KEYS.has(key)) {
    throw new Error(`unknown parameter "${key}". Known: ${knownList()}`)
  }
  const n = Number(rawVal)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new Error(`parameter "${key}": expected non-negative integer, got "${rawVal}"`)
  }
  return [key, n] as const
}
