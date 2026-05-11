import { describe, expect, test } from "bun:test"
import { detectKeyAlias, isPathLike } from "@/ir/alias"

describe("alias detection", () => {
  test("uuids → Uuid", () => {
    expect(detectKeyAlias(["550e8400-e29b-41d4-a716-446655440000", "6ba7b810-9dad-11d1-80b4-00c04fd430c8"])).toBe(
      "Uuid",
    )
  })

  test("paths → Path", () => {
    expect(detectKeyAlias(["/etc/hosts", "/var/log/syslog", "~/foo.txt"])).toBe("Path")
  })

  test("mixed → string", () => {
    expect(detectKeyAlias(["foo", "bar", "baz"])).toBe("string")
  })

  test("isPathLike", () => {
    expect(isPathLike("/x/y")).toBe(true)
    expect(isPathLike("a\\b")).toBe(true)
    expect(isPathLike("~foo")).toBe(true)
    expect(isPathLike("foo")).toBe(false)
  })
})
