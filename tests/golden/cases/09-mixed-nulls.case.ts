export const name = "mixed-nulls"
// Optional, null, missing, and present-with-value combinations.
export const input = `${`
{"a":1,"b":null,"c":"x"}
{"a":2,"b":null}
{"a":3,"c":"y","d":true}
{"a":4,"b":null,"c":null,"d":false}
`.trim()}\n`
export const options = { rootName: "Mixed" }
