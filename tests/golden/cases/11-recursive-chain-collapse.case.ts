// Regression: an unrolled recursive structure (nodes of `type:1` whose
// `children` arrays nest other type-1 nodes) used to materialise as a chain
// of distinct `Node_1_*` decls (`Node_1_a → Node_1_b → Node_1_c → ...`)
// because each depth seeded a unique IR object before hoisting. The
// `structural-dedupe` pass collapses these shape-equivalent objects into a
// single self-recursive decl.
export const name = "recursive-chain-collapse"
export const input = `${`
{"root":{"type":1,"name":"a","children":[{"type":1,"name":"b","children":[{"type":1,"name":"c","children":[{"type":1,"name":"d","children":[{"type":2,"text":"leaf"}]}]}]}]}}
{"root":{"type":1,"name":"a2","children":[{"type":2,"text":"x"}]}}
`.trim()}\n`
export const options = { rootName: "Doc" }
