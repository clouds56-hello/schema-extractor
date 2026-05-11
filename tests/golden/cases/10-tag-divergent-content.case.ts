// Regression: when two tagged objects sharing a `kind` literal have a
// non-prim field whose schema differs structurally (here `content`), the
// `field-tag` consolidation pass used to silently drop one shape because
// `combineInto`'s "shallow" combine ignored non-prim incoming schemas. The
// fix deep-merges differing non-prim props (cycle-safe), preserving both
// shapes as a union.
export const name = "tag-divergent-content"
export const input = `${`
{"response":[{"kind":"pts","content":{"value":"x","uris":{}}}]}
{"response":[{"kind":"other","x":1}]}
{"response":[{"kind":"pts","content":{"value":"y","isTrusted":true,"supportThemeIcons":false}}]}
`.trim()}\n`
export const options = { rootName: "Evt" }
