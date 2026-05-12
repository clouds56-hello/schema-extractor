import { describe, expect, test } from "bun:test"
import {
  DEFAULT_PARAMETERS,
  KNOWN_PARAMETER_KEYS,
  mergeParameters,
  parseParameterPair,
} from "@/parameters"

describe("parameters: defaults", () => {
  test("DEFAULT_PARAMETERS has the expected key set", () => {
    expect(new Set(Object.keys(DEFAULT_PARAMETERS))).toEqual(new Set(KNOWN_PARAMETER_KEYS))
    // Smoke-check known keys exist with expected defaults.
    expect(DEFAULT_PARAMETERS["hoist-shared.min-keys"]).toBe(2)
    expect(DEFAULT_PARAMETERS["hoist-shared.min-refs"]).toBe(2)
    expect(DEFAULT_PARAMETERS["pipeline.convergence-cap"]).toBe(4)
    expect(DEFAULT_PARAMETERS["structural-dedupe.max-passes"]).toBe(16)
    expect(DEFAULT_PARAMETERS["check.failure-cap"]).toBe(20)
  })
})

describe("mergeParameters", () => {
  test("undefined override returns base", () => {
    expect(mergeParameters(DEFAULT_PARAMETERS, undefined)).toBe(DEFAULT_PARAMETERS)
  })

  test("applies known overrides", () => {
    const m = mergeParameters(DEFAULT_PARAMETERS, { "hoist-shared.min-keys": 7 })
    expect(m["hoist-shared.min-keys"]).toBe(7)
    expect(m["hoist-shared.min-refs"]).toBe(2)
  })

  test("rejects unknown key with sorted hint", () => {
    expect(() => mergeParameters(DEFAULT_PARAMETERS, { "bogus.key": 1 })).toThrow(/unknown parameter/)
  })

  test("rejects negative", () => {
    expect(() => mergeParameters(DEFAULT_PARAMETERS, { "hoist-shared.min-keys": -1 })).toThrow(/non-negative/)
  })

  test("rejects float", () => {
    expect(() => mergeParameters(DEFAULT_PARAMETERS, { "hoist-shared.min-keys": 1.5 })).toThrow(/non-negative integer/)
  })
})

describe("parseParameterPair", () => {
  test("parses key=value", () => {
    expect(parseParameterPair("hoist-shared.min-keys=5")).toEqual(["hoist-shared.min-keys", 5])
  })

  test("rejects missing =", () => {
    expect(() => parseParameterPair("hoist-shared.min-keys")).toThrow(/key=value/)
  })

  test("rejects empty value", () => {
    expect(() => parseParameterPair("hoist-shared.min-keys=")).toThrow(/key=value/)
  })

  test("rejects unknown key", () => {
    expect(() => parseParameterPair("nope=1")).toThrow(/unknown parameter/)
  })

  test("rejects non-integer value", () => {
    expect(() => parseParameterPair("hoist-shared.min-keys=abc")).toThrow(/non-negative integer/)
  })
})
