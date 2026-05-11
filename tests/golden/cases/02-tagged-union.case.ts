export const name = "tagged-union";
export const input = `
{"type":"a","x":1}
{"type":"b","y":"q"}
{"type":"a","x":2,"x2":"opt"}
{"type":"c","z":[1,2,3]}
`.trim() + "\n";
export const options = { rootName: "Evt" };
