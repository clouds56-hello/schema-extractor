export const name = "vscode-patch-replay"
// kind:0 seed + kind:1 set + kind:2 append
export const input = `${`
{"kind":0,"v":{"version":1,"messages":[],"meta":{"createdAt":"2024-01-01T00:00:00Z"}}}
{"kind":1,"k":["meta","title"],"v":"hello"}
{"kind":2,"k":["messages"],"v":{"role":"user","content":"hi"}}
{"kind":2,"k":["messages"],"v":{"role":"assistant","content":"yo","toolCalls":[]}}
`.trim()}\n`
export const options = { rootName: "Session" }
