import { describe, expect, test } from "bun:test";
import { extractSchema } from "../../src/index.js";

describe("public API", () => {
  test("extractSchema simple", () => {
    const ts = extractSchema([{ a: 1 }, { a: 2, b: "x" }], { rootName: "X" });
    expect(ts).toContain("export type X");
    expect(ts).toContain("a: number");
    expect(ts).toContain("b?: string");
  });

  test("custom userTagKey forms a union", () => {
    const ts = extractSchema(
      [
        { op: "add", v: 1 },
        { op: "del", k: "x" },
      ],
      { rootName: "Cmd", userTagKey: "op" },
    );
    expect(ts).toMatch(/op:\s*"add"/);
    expect(ts).toMatch(/op:\s*"del"/);
  });
});
